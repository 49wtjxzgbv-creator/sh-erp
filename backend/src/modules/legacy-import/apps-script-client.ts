import { BadGatewayException, BadRequestException } from '@nestjs/common';
import type { LegacyExportPayload } from './transform';

const REQUIRED_ARRAY_KEYS: (keyof LegacyExportPayload)[] = [
  'products', 'suppliers', 'warehouses', 'warehouseStock',
  'assemblies', 'assemblyComponents', 'assemblyVersions',
  'customerOrders', 'customerOrderItems', 'history',
];

const FETCH_TIMEOUT_MS = 5 * 60 * 1000; // Apps Script Web App's own execution ceiling is ~6 minutes (Google quota) — this client's timeout stays comfortably under that so a genuine Google-side timeout surfaces as a real error rather than this client giving up first and masking it.

/**
 * Thin HTTP client for the customer-deployed `apps-script/WebAppExport.gs`
 * (see that file — it is NOT part of this backend's own deploy, it's what
 * the SHСклад customer pastes into their own legacy spreadsheet's Apps
 * Script editor and deploys as a Web App). Deliberately just `fetch` + shape
 * validation, no retry/backoff — a wizard dry-run/import is an
 * operator-initiated, human-watched action, not a background sync; a failed
 * fetch should surface immediately with a clear message, not silently retry
 * against what might be a misconfigured URL.
 */
export class AppsScriptClient {
  constructor(private readonly baseUrl: string, private readonly token: string) {}

  async fetchData(): Promise<LegacyExportPayload> {
    const url = this.buildUrl('data');
    const json = await this.fetchJson(url);
    validateExportPayload(json);
    return json;
  }

  async fetchPhoto(driveFileId: string): Promise<{ base64: string; mimeType: string }> {
    const url = this.buildUrl('photo', { fileId: driveFileId });
    const json = await this.fetchJson(url);
    if (typeof json !== 'object' || json === null || typeof (json as Record<string, unknown>).base64 !== 'string' || typeof (json as Record<string, unknown>).mimeType !== 'string') {
      throw new BadGatewayException(`Apps Script Web App returned an unexpected shape for action=photo&fileId=${driveFileId}.`);
    }
    return json as { base64: string; mimeType: string };
  }

  private buildUrl(action: string, extra: Record<string, string> = {}): string {
    const url = new URL(this.baseUrl);
    url.searchParams.set('action', action);
    url.searchParams.set('token', this.token);
    for (const [k, v] of Object.entries(extra)) url.searchParams.set(k, v);
    return url.toString();
  }

  private async fetchJson(url: string): Promise<unknown> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
    let response: Response;
    try {
      response = await fetch(url, { signal: controller.signal });
    } catch (err) {
      throw new BadGatewayException(
        `Could not reach the Apps Script Web App URL — check it was deployed with "Who has access: Anyone" and that the URL is the /exec (not /dev) link. ${err instanceof Error ? err.message : String(err)}`,
      );
    } finally {
      clearTimeout(timer);
    }

    if (!response.ok) {
      throw new BadGatewayException(`Apps Script Web App responded with HTTP ${response.status}.`);
    }

    let json: unknown;
    try {
      json = await response.json();
    } catch {
      throw new BadGatewayException('Apps Script Web App did not return valid JSON — is the deployed script the current WebAppExport.gs?');
    }

    if (typeof json === 'object' && json !== null && (json as Record<string, unknown>).error) {
      throw new BadRequestException(`Apps Script Web App reported an error: ${String((json as Record<string, unknown>).error)}`);
    }

    return json;
  }
}

function validateExportPayload(json: unknown): asserts json is LegacyExportPayload {
  if (typeof json !== 'object' || json === null) {
    throw new BadGatewayException('Apps Script Web App returned a non-object response for action=data.');
  }
  const obj = json as Record<string, unknown>;
  const missing = REQUIRED_ARRAY_KEYS.filter((key) => !Array.isArray(obj[key]));
  if (missing.length > 0) {
    throw new BadGatewayException(
      `Apps Script Web App's action=data response is missing (or has non-array) key(s): ${missing.join(', ')}. ` +
        `This usually means the deployed script is an older version of WebAppExport.gs — redeploy the latest one.`,
    );
  }
}
