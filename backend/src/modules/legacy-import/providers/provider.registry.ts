import { BadRequestException } from '@nestjs/common';
import { GoogleAppsScriptProvider } from './google-apps-script.provider';
import type { ImportConnectorProvider } from './provider.interface';

/**
 * Every supported connector provider, keyed by `ImportConnection.providerType`
 * (a plain string column, not a Postgres enum — see schema.prisma's header
 * comment — precisely so a new provider is addable here without a schema
 * migration). Adding a future provider (Excel/CSV upload, 1C, BAS, Odoo, ...)
 * is: implement `ImportConnectorProvider`, add one line below.
 */
const PROVIDERS: Record<string, ImportConnectorProvider> = {
  GOOGLE_APPS_SCRIPT: new GoogleAppsScriptProvider(),
};

export function getImportProvider(providerType: string): ImportConnectorProvider {
  const provider = PROVIDERS[providerType];
  if (!provider) {
    throw new BadRequestException(`Unknown import provider type: ${providerType}`);
  }
  return provider;
}

export function listImportProviders(): { type: string; displayName: string }[] {
  return Object.values(PROVIDERS).map((p) => ({ type: p.type, displayName: p.displayName }));
}
