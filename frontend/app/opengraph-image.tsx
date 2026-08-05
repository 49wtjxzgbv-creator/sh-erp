import { ImageResponse } from 'next/og';

export const runtime = 'edge';
export const alt = 'SH ERP — виробничий та складський облік для реального бізнесу';
export const size = { width: 1200, height: 630 };
export const contentType = 'image/png';

/**
 * Generated at request time via Next's built-in `next/og` (no external
 * image asset to keep in sync with copy changes) — the same headline/accent
 * used on the Landing Page's Hero, so a shared link preview matches what
 * the page itself says.
 */
export default async function OpengraphImage() {
  return new ImageResponse(
    (
      <div
        style={{
          width: '100%',
          height: '100%',
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'center',
          padding: '80px',
          background: 'linear-gradient(135deg, #0f0f13 0%, #1a1425 60%, #2a1a45 100%)',
          fontFamily: 'sans-serif',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 16, marginBottom: 40 }}>
          <div
            style={{
              width: 56,
              height: 56,
              borderRadius: 14,
              background: '#7c3aed',
              display: 'flex',
            }}
          />
          <div style={{ fontSize: 40, fontWeight: 700, color: '#ffffff' }}>SH ERP</div>
        </div>
        <div style={{ fontSize: 56, fontWeight: 700, color: '#ffffff', lineHeight: 1.15, maxWidth: 980 }}>
          Виробництво, склад і продажі — в одній системі
        </div>
        <div style={{ fontSize: 28, color: '#c4b5fd', marginTop: 24, maxWidth: 880 }}>
          Сучасна ERP для реального бізнесу. BOM, AI-асистент, звіти. Почніть безкоштовно.
        </div>
      </div>
    ),
    { ...size },
  );
}
