'use client';

import { createContext, useContext, useState, useEffect } from 'react';
import { usePathname } from 'next/navigation';

interface MobileNavContextValue {
  open: boolean;
  setOpen: (open: boolean) => void;
}

const MobileNavContext = createContext<MobileNavContextValue | null>(null);

/**
 * Shared open/closed state for the mobile nav drawer — Sidebar (the panel)
 * and Topbar (the hamburger trigger) are siblings under AppLayout, not
 * parent/child, so this is the smallest thing that lets one open what the
 * other renders. Mirrors ThemeProvider's plain-Context shape (no external
 * state library needed for one boolean).
 */
export function MobileNavProvider({ children }: { children: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  const pathname = usePathname();

  // Close automatically on navigation — otherwise the drawer stays open
  // over the newly-loaded page after tapping a nav link.
  useEffect(() => {
    setOpen(false);
  }, [pathname]);

  return <MobileNavContext.Provider value={{ open, setOpen }}>{children}</MobileNavContext.Provider>;
}

export function useMobileNav() {
  const ctx = useContext(MobileNavContext);
  if (!ctx) throw new Error('useMobileNav must be used within MobileNavProvider');
  return ctx;
}
