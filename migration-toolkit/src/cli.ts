#!/usr/bin/env node
import 'dotenv/config';
import { Command } from 'commander';
import { PrismaClient } from '@prisma/client';
import { extractCompany } from './extract';
import { writeSnapshot, readSnapshot, latestRunDir } from './snapshot-io';
import { transformCompany } from './transform';
import { loadCompanyGraph } from './load';
import { verifyMigration } from './verify';
import type { CompanyMigrationInput } from './types';

/**
 * `migrate-company` — the 5-stage CLI orchestration (Phase 4 design doc
 * §1: "migrate-company --source-sheet-id <id> --company-slug <slug>
 * [--dry-run]. Same code path runs the first real cutover and every
 * subsequent customer's onboarding migration."
 *
 * `--dry-run` (§2.5): "runs all four stages above against a SEPARATE,
 * disposable Postgres database ... not a 'transaction that gets rolled
 * back' against the real production database, since RLS policies, CHECK
 * constraints, and the immutability REVOKE grants should all be exercised
 * for real during a dry run." Enforced here by REQUIRING an explicit
 * `--database-url` in dry-run mode rather than silently falling back to
 * `process.env.DATABASE_URL` — an operator who forgets `--database-url`
 * gets a clear error, not an accidental write against whatever
 * `DATABASE_URL` happens to be set to in their shell.
 *
 * A real (non-dry-run) migration is, per the design doc, "a manual,
 * single-operator action" — this CLI builds no automation for scheduling
 * or triggering it; someone runs this command by hand at the agreed
 * cutover moment.
 */

const program = new Command();

program
  .name('migrate-company')
  .description('SH ERP legacy-data migration: Google Sheets -> Postgres, per company.')
  .requiredOption('--source-sheet-id <id>', 'Google Sheets spreadsheet ID of the legacy deployment')
  .requiredOption('--company-slug <slug>', 'New company slug (subdomain) to create/target')
  .requiredOption('--company-name <name>', 'Company display name')
  .requiredOption('--owner-email <email>', 'Email for the migrated owner/admin account')
  .requiredOption('--owner-full-name <name>', 'Full name for the migrated owner/admin account')
  .requiredOption('--owner-password <password>', 'Initial password for the migrated owner/admin account (hashed with argon2, never stored raw)')
  .option('--source-deployment-id <id>', 'Old Apps Script deployment identifier, stored on Company.legacyId for support traceability')
  .option('--timezone <tz>', 'Company timezone', 'Europe/Kyiv')
  .option('--locale <locale>', 'Company default locale', 'uk')
  .option('--snapshot-dir <dir>', 'Directory to read/write extraction snapshots', './snapshots')
  .option('--from-snapshot <dir|latest>', 'Skip live extraction and transform from a previously saved snapshot directory ("latest" resolves the most recent run for this company)')
  .option('--google-credentials <path>', 'Path to a Google service-account JSON key (defaults to GOOGLE_APPLICATION_CREDENTIALS)')
  .option('--database-url <url>', 'Postgres connection string to load into (required with --dry-run; falls back to DATABASE_URL env var otherwise)')
  .option('--dry-run', 'Load into a disposable/scratch database instead of the real one — requires --database-url explicitly', false)
  .option('--spot-check-sample-size <n>', 'Number of Products to spot-check against the live database after load', '15')
  .action(async (opts) => {
    if (opts.dryRun && !opts.databaseUrl) {
      console.error('ERROR: --dry-run requires an explicit --database-url pointing at a disposable/scratch Postgres instance. Refusing to guess.');
      process.exit(1);
    }
    const databaseUrl = opts.databaseUrl ?? process.env.DATABASE_URL;
    if (!databaseUrl) {
      console.error('ERROR: no database URL — pass --database-url or set DATABASE_URL.');
      process.exit(1);
    }

    console.log(`\n=== migrate-company ===`);
    console.log(`Company: ${opts.companyName} (${opts.companySlug})`);
    console.log(`Mode: ${opts.dryRun ? 'DRY RUN (disposable database)' : 'REAL CUTOVER — this writes production data'}`);
    if (!opts.dryRun) {
      console.log('This is NOT a dry run. Ctrl+C now if that was not intentional.');
    }

    // --- Stage 1: Extract (or reuse a snapshot) ---
    let snapshot;
    if (opts.fromSnapshot) {
      const dir = opts.fromSnapshot === 'latest'
        ? latestRunDir(opts.snapshotDir, opts.companySlug)
        : opts.fromSnapshot;
      if (!dir) {
        console.error(`ERROR: no snapshot found for company "${opts.companySlug}" under ${opts.snapshotDir}.`);
        process.exit(1);
      }
      console.log(`\n[1/4] Reading snapshot from ${dir} (skipping live extraction) ...`);
      snapshot = readSnapshot(dir as string);
    } else {
      console.log(`\n[1/4] Extracting from Google Sheet ${opts.sourceSheetId} ...`);
      snapshot = await extractCompany({
        sourceSheetId: opts.sourceSheetId,
        companySlug: opts.companySlug,
        credentialsPath: opts.googleCredentials,
      });
      const savedTo = writeSnapshot(opts.snapshotDir, snapshot);
      console.log(`Snapshot saved to ${savedTo}`);
    }
    console.log(`Extracted ${Object.values(snapshot.sheets).reduce((sum, s) => sum + (s?.rows.length ?? 0), 0)} rows across ${Object.keys(snapshot.sheets).length} sheets.`);

    // --- Stage 2: Transform ---
    console.log(`\n[2/4] Transforming ...`);
    const input: CompanyMigrationInput = {
      companySlug: opts.companySlug,
      companyName: opts.companyName,
      timezone: opts.timezone,
      locale: opts.locale,
      sourceDeploymentId: opts.sourceDeploymentId,
      ownerEmail: opts.ownerEmail,
      ownerFullName: opts.ownerFullName,
      ownerPassword: opts.ownerPassword,
    };
    const graph = transformCompany(snapshot, input);
    console.log(`Transform produced ${graph.products.length} products, ${graph.assemblies.length} assemblies, ${graph.productionOrders.length} production orders, ${graph.customerOrders.length} customer orders (and more) — ${graph.warnings.length} data-quality warning(s).`);
    if (graph.warnings.length > 0) {
      console.log(`First 10 warnings:`);
      for (const w of graph.warnings.slice(0, 10)) console.log(`  [${w.step}] ${w.message}`);
    }

    // --- Stage 3: Load ---
    console.log(`\n[3/4] Loading into ${opts.dryRun ? 'DISPOSABLE' : 'TARGET'} database ...`);
    const prisma = new PrismaClient({ datasources: { db: { url: databaseUrl } } });
    try {
      const loadResult = await loadCompanyGraph(prisma, graph);
      console.log(`Load complete: ${JSON.stringify(loadResult.counts, null, 2)}`);

      // --- Stage 4: Verify ---
      console.log(`\n[4/4] Verifying ...`);
      const report = await verifyMigration(prisma, graph.company.id, snapshot, graph, {
        spotCheckSampleSize: Number(opts.spotCheckSampleSize),
      });
      console.log(`\n=== Reconciliation report ===`);
      console.log(`Row counts: ${report.rowCounts.filter((c) => c.isNaiveOneToOneCheck).map((c) => `${c.sheet}=${c.passed ? 'OK' : 'MISMATCH'}`).join(', ')}`);
      console.log(`Sum check (total qty vs warehouse stock): ${report.sumCheck.passed ? 'PASSED' : `FAILED (${report.sumCheck.mismatches.length} product(s) mismatched)`}`);
      console.log(`Spot checks: ${report.spotChecks.filter((s) => s.matched).length}/${report.spotChecks.length} matched`);
      console.log(`\nOverall: ${report.looksHealthy ? 'LOOKS HEALTHY' : 'NEEDS REVIEW — see the full report before treating this migration as trustworthy'}`);
      if (!report.looksHealthy) process.exitCode = 1;
    } finally {
      await prisma.$disconnect();
    }
  });

program.parseAsync(process.argv).catch((err) => {
  console.error('Migration failed:', err);
  process.exit(1);
});
