import type { MetadataRoute } from 'next';
import { getPublishedLandingPage } from '@/lib/landing-page/get-published-content';

const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL ?? 'https://sh-erp.com';

/**
 * Next.js file convention — generates /sitemap.xml. Only the two real
 * public, indexable pages ("/" and "/register") — every other route is
 * either an authenticated app screen or a private auth tree, both already
 * excluded via robots.ts + their own noindex metadata, so listing them
 * here would just contradict that. `lastModified` on "/" comes from the
 * real PUBLISHED LandingPageVersion's `publishedAt`, not a guess.
 */
export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  let homeLastModified: Date | undefined;
  try {
    const { publishedAt } = await getPublishedLandingPage();
    homeLastModified = publishedAt ? new Date(publishedAt) : undefined;
  } catch {
    // Backend unreachable at build/request time — fall back to no explicit
    // lastModified rather than failing sitemap generation entirely.
  }

  return [
    {
      url: SITE_URL,
      lastModified: homeLastModified,
      changeFrequency: 'weekly',
      priority: 1,
    },
    {
      url: `${SITE_URL}/register`,
      changeFrequency: 'monthly',
      priority: 0.8,
    },
  ];
}
