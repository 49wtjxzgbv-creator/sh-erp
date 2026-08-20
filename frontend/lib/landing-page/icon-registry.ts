import {
  Factory,
  Warehouse,
  Truck,
  ShoppingCart,
  ListTree,
  Sparkles,
  BarChart3,
  Users,
  ShieldCheck,
  Zap,
  Building2,
  Globe,
  ClipboardCheck,
  PackageCheck,
  Boxes,
  Handshake,
  LineChart,
  Layers,
  type LucideIcon,
} from 'lucide-react';

/**
 * Mirrors backend/src/modules/landing-page/landing-page-content.types.ts's
 * LANDING_ICON_REGISTRY exactly (same key strings) — the backend is the
 * source of truth for which keys are valid; this just maps each key to its
 * actual component for rendering. `modules[].icon`/`benefits.items[].icon`
 * are always a key into this map, never free-text SVG/HTML.
 */
export const LANDING_ICON_REGISTRY: Record<string, LucideIcon> = {
  Factory,
  Warehouse,
  Truck,
  ShoppingCart,
  ListTree,
  Sparkles,
  BarChart3,
  Users,
  ShieldCheck,
  Zap,
  Building2,
  Globe,
  ClipboardCheck,
  PackageCheck,
  Boxes,
  Handshake,
  LineChart,
  Layers,
};

/** Falls back to Sparkles for an unrecognized key rather than crashing render — defensive against a future registry drift between frontend/backend. */
export function getLandingIcon(key: string): LucideIcon {
  return LANDING_ICON_REGISTRY[key] ?? Sparkles;
}
