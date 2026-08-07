import type { LegacyExportPayload } from '../transform';

/**
 * Universal import-connector interface (2026-08-07 provider-agnostic
 * revision) — Google Apps Script (`google-apps-script.provider.ts`) is the
 * first and currently only implementation. A future provider (Excel/CSV
 * upload, 1C, BAS, Odoo, ...) is a new class implementing this interface
 * plus one entry in `provider.registry.ts` — nothing in
 * `legacy-import.service.ts`, `transform/*`, or the frontend connections
 * list needs to change to add one, since they all already operate in terms
 * of this interface and the provider-agnostic `LegacyExportPayload` shape
 * `transform/index.ts` already consumes.
 *
 * Every method here is deliberately Prisma-free — `legacy-import.service.ts`
 * owns all persistence (finding/creating/updating `ImportConnection` rows);
 * a provider only ever receives/returns plain data, which keeps providers
 * trivially unit-testable and keeps the "who talks to the database" boundary
 * in exactly one place.
 */

export interface ImportSetupContext {
  companyId: string;
  userId: string;
}

/** A provider that needs a human-relayed handshake (Apps Script's pairing-code flow) returns this from `initiateSetup`. */
export interface PairingRequiredSetupResult {
  requiresPairing: true;
  pairingCode: string;
  expiresAt: Date;
}

/** A provider with no handshake step (e.g. a future direct file-upload provider) can go straight to PAIRED. */
export interface NoPairingSetupResult {
  requiresPairing: false;
  config: unknown;
  protocolVersion?: string;
  connectorVersion?: string;
}

export type SetupResult = PairingRequiredSetupResult | NoPairingSetupResult;

/** Result of a provider validating and completing an inbound pairing call (e.g. the connector's own `completePairing` POST). */
export interface CompleteSetupResult<TConfig = unknown> {
  /** Provider-specific config to store (encrypted) on the ImportConnection row — e.g. `{ webAppUrl, connectionToken }` for Apps Script. */
  config: TConfig;
  protocolVersion?: string;
  connectorVersion?: string;
  /** What to send back over HTTP to whatever called the pairing endpoint (the connector script) — wire format is entirely provider-owned, since only the provider's own remote counterpart needs to parse it. */
  responseBody: unknown;
}

/** Opaque reference to one photo, resolved during transform (e.g. a Google Drive file id) — generic enough for any provider that can address individual assets by an id string. */
export interface PhotoRef {
  id: string;
}

export interface ConnectorHealthDiagnostic {
  label: string;
  ok: boolean;
  detail?: string;
}

export interface ConnectorHealth {
  reachable: boolean;
  protocolVersion?: string;
  protocolSupported: boolean;
  providerVersion?: string;
  capabilities: string[];
  diagnostics: ConnectorHealthDiagnostic[];
  checkedAt: string;
}

export interface ImportConnectorProvider<TConfig = unknown> {
  readonly type: string;
  readonly displayName: string;

  /** Starts connecting a new source. For a pairing-style provider, generates and returns a pairing code (persisted by the caller) rather than touching Prisma itself. */
  initiateSetup(ctx: ImportSetupContext): Promise<SetupResult>;

  /**
   * Validates and completes an inbound setup/pairing call. The caller
   * (legacy-import.service.ts's public pairing endpoint handler) has
   * already confirmed the pairing code exists, isn't expired, and isn't
   * already used — this method only interprets the provider-specific
   * payload (e.g. `{ webAppUrl, protocolVersion, connectorVersion }`) and
   * mints whatever credential the provider's own protocol requires.
   */
  completeSetup(payload: unknown): Promise<CompleteSetupResult<TConfig>>;

  fetchData(config: TConfig): Promise<LegacyExportPayload>;

  checkHealth(config: TConfig): Promise<ConnectorHealth>;

  fetchPhoto(config: TConfig, ref: PhotoRef): Promise<{ base64: string; mimeType: string }>;

  /** Best-effort remote revoke (e.g. ask the connector to forget its stored token) — must never throw; a network failure here should never block the LOCAL revoke (the caller always clears its own stored config regardless of this call's outcome). */
  revoke(config: TConfig): Promise<void>;
}
