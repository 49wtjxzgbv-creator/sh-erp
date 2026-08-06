import { S3Client } from '@aws-sdk/client-s3';

/**
 * Cloudflare R2 is S3-compatible (Phase 2 §7 / ADR-0004: chosen over S3
 * itself for zero egress fees), so the AWS SDK's S3Client works unmodified
 * against it — only the endpoint differs. Configured from env vars set at
 * deploy time (Railway), never hard-coded.
 */
export function createR2Client(): S3Client {
  return new S3Client({
    region: 'auto',
    endpoint: process.env.R2_ENDPOINT,
    // Required for any S3-compatible endpoint addressed by bare host/IP
    // rather than a real DNS name with wildcard subdomain support (e.g. a
    // self-hosted MinIO at http://127.0.0.1:9000) — without this the SDK
    // defaults to virtual-hosted-style (`bucket.host`), which is not a
    // valid hostname when `host` is already an IP literal. Also fully
    // supported by real Cloudflare R2, so this is safe either way.
    forcePathStyle: true,
    credentials: {
      accessKeyId: process.env.R2_ACCESS_KEY_ID ?? '',
      secretAccessKey: process.env.R2_SECRET_ACCESS_KEY ?? '',
    },
  });
}

export const R2_BUCKET = process.env.R2_BUCKET ?? 'sh-erp-files';
