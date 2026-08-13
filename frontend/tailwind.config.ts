import type { Config } from 'tailwindcss';

/**
 * Design system v2 (2026-08-14 redesign). Dark + light theme, purple accent,
 * "SH ERP by Shyring" (Phase 2 §3.5). Colors are CSS variables (set in
 * app/globals.css) rather than hardcoded hex, so a company's branding record
 * can override the accent at the tenant-shell layout level without a
 * rebuild — see components/domain/shell/BrandingProvider.tsx (not yet built).
 */
const config: Config = {
  darkMode: ['class'],
  content: ['./app/**/*.{ts,tsx}', './components/**/*.{ts,tsx}'],
  theme: {
    container: {
      center: true,
      padding: '1.5rem',
      screens: { '2xl': '1400px' },
    },
    extend: {
      fontFamily: {
        sans: ['var(--font-inter)', 'ui-sans-serif', 'system-ui', 'sans-serif'],
      },
      colors: {
        border: 'hsl(var(--border))',
        input: 'hsl(var(--input))',
        ring: 'hsl(var(--ring))',
        background: 'hsl(var(--background))',
        foreground: 'hsl(var(--foreground))',
        primary: {
          DEFAULT: 'hsl(var(--primary))',
          foreground: 'hsl(var(--primary-foreground))',
        },
        secondary: {
          DEFAULT: 'hsl(var(--secondary))',
          foreground: 'hsl(var(--secondary-foreground))',
        },
        destructive: {
          DEFAULT: 'hsl(var(--destructive))',
          foreground: 'hsl(var(--destructive-foreground))',
        },
        muted: {
          DEFAULT: 'hsl(var(--muted))',
          foreground: 'hsl(var(--muted-foreground))',
        },
        accent: {
          DEFAULT: 'hsl(var(--accent))',
          foreground: 'hsl(var(--accent-foreground))',
        },
        card: {
          DEFAULT: 'hsl(var(--card))',
          foreground: 'hsl(var(--card-foreground))',
        },
        popover: {
          DEFAULT: 'hsl(var(--popover))',
          foreground: 'hsl(var(--popover-foreground))',
        },
        /** Between `background` and `card` — chrome that sits on the page but below content (sidebar, panel backdrops), not a content surface itself. */
        surface: {
          DEFAULT: 'hsl(var(--surface))',
          foreground: 'hsl(var(--surface-foreground))',
        },
        success: {
          DEFAULT: 'hsl(var(--success))',
          foreground: 'hsl(var(--success-foreground))',
        },
        warning: {
          DEFAULT: 'hsl(var(--warning))',
          foreground: 'hsl(var(--warning-foreground))',
        },
      },
      borderRadius: {
        lg: 'var(--radius)',
        md: 'calc(var(--radius) - 2px)',
        sm: 'calc(var(--radius) - 4px)',
      },
      /**
       * Elevation is primarily conveyed by the surface lightness ladder
       * above + a hairline border; shadow is a light secondary touch (most
       * visible in light mode, barely there in dark — same principle as the
       * Planner card redesign this scale was lifted from). No "floating
       * glass" — every step stays under ~10% opacity.
       */
      boxShadow: {
        xs: '0 1px 2px 0 rgba(0,0,0,0.04)',
        sm: '0 1px 2px rgba(0,0,0,0.06), 0 1px 3px rgba(0,0,0,0.08)',
        md: '0 2px 4px rgba(0,0,0,0.06), 0 4px 10px rgba(0,0,0,0.08)',
        lg: '0 4px 8px rgba(0,0,0,0.08), 0 10px 24px rgba(0,0,0,0.12)',
      },
    },
  },
  plugins: [],
};

export default config;
