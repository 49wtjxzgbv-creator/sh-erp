import { redirect } from 'next/navigation';

/**
 * Root path has no content of its own — middleware.ts already gates
 * /dashboard behind the refresh-token cookie check, so this single redirect
 * covers both cases (signed in → dashboard; signed out → bounced to /login
 * by middleware) without duplicating that logic here.
 */
export default function RootPage() {
  redirect('/dashboard');
}
