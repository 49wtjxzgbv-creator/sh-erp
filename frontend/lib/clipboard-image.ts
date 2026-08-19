/**
 * Reads an image out of the OS clipboard via the async Clipboard API (a
 * user-gesture-triggered read, e.g. a "Вставити" button click — not a
 * `paste` keyboard-event listener, which would only fire while some
 * specific element has focus). Requires a secure context (sh-erp.pro is
 * HTTPS) and browser support (all modern Chromium/Firefox/Safari); returns
 * null rather than throwing when the API is unavailable or the clipboard
 * simply has no image, so callers can show a plain "nothing to paste"
 * message instead of a scary error.
 */
export async function readImageFromClipboard(): Promise<File | null> {
  if (!navigator.clipboard?.read) return null;
  const items = await navigator.clipboard.read();
  for (const item of items) {
    const imageType = item.types.find((t) => t.startsWith('image/'));
    if (imageType) {
      const blob = await item.getType(imageType);
      const ext = imageType.split('/')[1] || 'png';
      return new File([blob], `pasted-image.${ext}`, { type: imageType });
    }
  }
  return null;
}

/** First image file dropped onto a drop zone, or null if the drop had no image. */
export function readImageFromDrop(e: React.DragEvent): File | null {
  const file = Array.from(e.dataTransfer.files).find((f) => f.type.startsWith('image/'));
  return file ?? null;
}
