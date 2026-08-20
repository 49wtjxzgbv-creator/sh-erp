/**
 * The one master SH ERP logo mark. The source master is public/brand/logo.svg
 * (kept byte-for-byte as supplied — never redrawn/edited). This component
 * renders public/brand/logo-1024.png instead of that SVG directly: the
 * master file's own exported canvas has a ~1.6% blank margin plus corner
 * curvature that together read as a visible white/grey fringe once placed
 * on a dark background. logo-1024.png is a straight derivative — the
 * master rendered, its blank canvas margin cropped to content bounds, and
 * its own already-rounded silhouette given real alpha transparency instead
 * of a near-white fill outside it. Same letterforms, same colors, same
 * proportions; only the surrounding blank canvas is trimmed, exactly like
 * any other "prepare derivative icons from the master" step.
 */
export function Logo({ size = 32, className }: { size?: number; className?: string }) {
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img src="/brand/logo-1024.png" alt="SH ERP" width={size} height={size} className={className} />
  );
}
