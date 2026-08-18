import { BadGatewayException } from '@nestjs/common';
import { randomBytes } from 'node:crypto';
import { CodedBadRequestException } from '../../../common/api-exceptions';
import type { LegacyExportPayload } from '../transform';
import type {
  CompleteSetupResult,
  ConnectorHealth,
  ImportConnectorProvider,
  ImportSetupContext,
  PhotoRef,
  SetupResult,
} from './provider.interface';

/** Bumped on any breaking change to the doGet contract (required sheet keys, action names, response shapes) — see this provider's `SUPPORTED_PROTOCOL_VERSIONS`. Additive-only changes (a new optional field) don't need a bump. */
export const CONNECTOR_PROTOCOL_VERSION = '1.0';
const SUPPORTED_PROTOCOL_VERSIONS = new Set(['1.0']);

const PAIRING_CODE_TTL_MS = 30 * 60 * 1000;
const FETCH_TIMEOUT_MS = 5 * 60 * 1000; // Apps Script Web App's own execution ceiling is ~6 minutes (Google quota) — this client's timeout stays comfortably under that so a genuine Google-side timeout surfaces as a real error rather than this client giving up first and masking it.

const REQUIRED_ARRAY_KEYS: (keyof LegacyExportPayload)[] = [
  'products', 'suppliers', 'warehouses', 'warehouseStock',
  'assemblies', 'assemblyComponents', 'assemblyVersions',
  'customerOrders', 'customerOrderItems', 'history',
];

export interface GoogleAppsScriptConfig {
  webAppUrl: string;
  connectionToken: string;
}

interface PairingPayload {
  webAppUrl?: unknown;
  protocolVersion?: unknown;
  connectorVersion?: unknown;
}

/**
 * First implementation of `ImportConnectorProvider` — connects to a
 * customer-deployed "SH ERP Import Connector" Google Apps Script Web App
 * (`apps-script/SHERPImportConnector.gs`). Auth is a device-pairing
 * handshake, not the URL: `completeSetup` mints a real `connectionToken`
 * (never typed by the user) once the caller (legacy-import.service.ts) has
 * already verified a valid, unexpired pairing code — the URL the connector
 * reports at that point is just an address, not a credential.
 */
export class GoogleAppsScriptProvider implements ImportConnectorProvider<GoogleAppsScriptConfig> {
  readonly type = 'GOOGLE_APPS_SCRIPT';
  readonly displayName = 'Google Apps Script';

  async initiateSetup(_ctx: ImportSetupContext): Promise<SetupResult> {
    return {
      requiresPairing: true,
      pairingCode: generatePairingCode(),
      expiresAt: new Date(Date.now() + PAIRING_CODE_TTL_MS),
    };
  }

  async completeSetup(payload: unknown): Promise<CompleteSetupResult<GoogleAppsScriptConfig>> {
    const p = (payload ?? {}) as PairingPayload;
    if (typeof p.webAppUrl !== 'string' || !isHttpsUrl(p.webAppUrl)) {
      throw new CodedBadRequestException('IMPORT_PAIRING_PAYLOAD_INVALID', 'Pairing payload is missing a valid HTTPS webAppUrl.');
    }
    const protocolVersion = typeof p.protocolVersion === 'string' ? p.protocolVersion : undefined;
    const connectorVersion = typeof p.connectorVersion === 'string' ? p.connectorVersion : undefined;
    if (!protocolVersion || !SUPPORTED_PROTOCOL_VERSIONS.has(protocolVersion)) {
      throw new CodedBadRequestException(
        'IMPORT_UNSUPPORTED_PROTOCOL_VERSION',
        `Версія конектора (protocolVersion=${protocolVersion ?? 'відсутня'}) не підтримується цією версією SH ERP ` +
          `(підтримується: ${Array.from(SUPPORTED_PROTOCOL_VERSIONS).join(', ')}). Оновіть SH ERP Import Connector до останньої версії.`,
      );
    }

    const connectionToken = randomBytes(32).toString('base64url');
    return {
      config: { webAppUrl: p.webAppUrl, connectionToken },
      protocolVersion,
      connectorVersion,
      responseBody: { ok: true, connectionToken, protocolVersion: CONNECTOR_PROTOCOL_VERSION },
    };
  }

  async fetchData(config: GoogleAppsScriptConfig): Promise<LegacyExportPayload> {
    const json = await this.fetchJson(config, 'data');
    validateExportPayload(json);
    return json;
  }

  async checkHealth(config: GoogleAppsScriptConfig): Promise<ConnectorHealth> {
    const checkedAt = new Date().toISOString();
    let json: unknown;
    try {
      json = await this.fetchJson(config, 'health');
    } catch (err) {
      return {
        reachable: false,
        protocolSupported: false,
        capabilities: [],
        diagnostics: [{ label: 'Доступність Web App', ok: false, detail: err instanceof Error ? err.message : String(err) }],
        checkedAt,
      };
    }

    const h = json as Record<string, unknown>;
    const protocolVersion = typeof h.protocolVersion === 'string' ? h.protocolVersion : undefined;
    const protocolSupported = protocolVersion !== undefined && SUPPORTED_PROTOCOL_VERSIONS.has(protocolVersion);
    const capabilities = Array.isArray(h.capabilities) ? h.capabilities.filter((c): c is string => typeof c === 'string') : [];

    return {
      reachable: true,
      protocolVersion,
      protocolSupported,
      providerVersion: typeof h.connectorVersion === 'string' ? h.connectorVersion : undefined,
      capabilities,
      diagnostics: [
        { label: 'Версія протоколу', ok: protocolSupported, detail: protocolVersion },
        { label: 'Доступ до таблиці', ok: h.spreadsheetAccessible === true },
        { label: 'Доступ до Google Drive', ok: h.driveAccessible === true },
      ],
      checkedAt,
    };
  }

  async fetchPhoto(config: GoogleAppsScriptConfig, ref: PhotoRef): Promise<{ base64: string; mimeType: string }> {
    const json = await this.fetchJson(config, 'photo', { fileId: ref.id });
    if (typeof json !== 'object' || json === null || typeof (json as Record<string, unknown>).base64 !== 'string' || typeof (json as Record<string, unknown>).mimeType !== 'string') {
      throw new BadGatewayException(`Конектор повернув неочікувану відповідь для action=photo&fileId=${ref.id}.`);
    }
    return json as { base64: string; mimeType: string };
  }

  async revoke(config: GoogleAppsScriptConfig): Promise<void> {
    try {
      await this.fetchJson(config, 'revoke');
    } catch {
      // Best-effort — the LOCAL revoke (clearing our own stored config) always proceeds regardless. A network hiccup or an already-redeployed/deleted script must never block the user from disconnecting on the SH ERP side.
    }
  }

  private buildUrl(config: GoogleAppsScriptConfig, action: string, extra: Record<string, string> = {}): string {
    const url = new URL(config.webAppUrl);
    url.searchParams.set('action', action);
    url.searchParams.set('token', config.connectionToken);
    for (const [k, v] of Object.entries(extra)) url.searchParams.set(k, v);
    return url.toString();
  }

  private async fetchJson(config: GoogleAppsScriptConfig, action: string, extra: Record<string, string> = {}): Promise<unknown> {
    const url = this.buildUrl(config, action, extra);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
    let response: Response;
    try {
      response = await fetch(url, { signal: controller.signal });
    } catch (err) {
      throw new BadGatewayException(
        `Не вдалося звернутись до Web App конектора — перевірте, що деплой має "Who has access: Anyone" і URL веде на /exec (не /dev). ${err instanceof Error ? err.message : String(err)}`,
      );
    } finally {
      clearTimeout(timer);
    }

    if (!response.ok) {
      throw new BadGatewayException(`Конектор відповів HTTP ${response.status}.`);
    }

    let json: unknown;
    try {
      json = await response.json();
    } catch {
      throw new BadGatewayException('Конектор не повернув коректний JSON — можливо, розгорнута застаріла версія скрипта.');
    }

    if (typeof json === 'object' && json !== null && (json as Record<string, unknown>).error) {
      throw new CodedBadRequestException('IMPORT_CONNECTOR_ERROR', `Конектор повідомив про помилку: ${String((json as Record<string, unknown>).error)}`);
    }

    return json;
  }
}

function isHttpsUrl(value: string): boolean {
  try {
    return new URL(value).protocol === 'https:';
  } catch {
    return false;
  }
}

function validateExportPayload(json: unknown): asserts json is LegacyExportPayload {
  if (typeof json !== 'object' || json === null) {
    throw new BadGatewayException('Конектор повернув не-об\'єкт для action=data.');
  }
  const obj = json as Record<string, unknown>;
  const missing = REQUIRED_ARRAY_KEYS.filter((key) => !Array.isArray(obj[key]));
  if (missing.length > 0) {
    throw new BadGatewayException(
      `Відповідь конектора (action=data) не містить (або має не-масив) ключі: ${missing.join(', ')}. ` +
        `Зазвичай це означає, що розгорнутий скрипт застарів — перевстановіть останню версію SH ERP Import Connector.`,
    );
  }
}

/** Human-typeable pairing code — excludes visually ambiguous characters (0/O, 1/I/L) since this is read off a screen and typed into a Sheets dialog by hand. */
function generatePairingCode(): string {
  const alphabet = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
  const bytes = randomBytes(8);
  let code = '';
  for (let i = 0; i < 8; i++) {
    code += alphabet[bytes[i] % alphabet.length];
    if (i === 3) code += '-';
  }
  return code;
}
