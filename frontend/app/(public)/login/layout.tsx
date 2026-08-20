import type { Metadata } from 'next';

/** A bare sign-in form has no unique content to rank on and would only compete with "/" for the same commercial queries — keep it out of the index. */
export const metadata: Metadata = {
  robots: { index: false, follow: false },
};

export default function LoginLayout({ children }: { children: React.ReactNode }) {
  return children;
}
