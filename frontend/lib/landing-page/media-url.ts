/** Looks up a media id in the `mediaUrls` map already resolved server-side by GET /landing-page — a missing entry means "no image", not an error. */
export function landingMediaUrl(mediaUrls: Record<string, string>, imageId: string | null | undefined): string | null {
  if (!imageId) return null;
  return mediaUrls[imageId] ?? null;
}
