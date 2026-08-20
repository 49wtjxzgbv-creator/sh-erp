import type { MetadataRoute } from 'next';

const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL ?? 'https://sh-erp.com';

/**
 * Next.js file convention — generates /robots.txt. Disallows every
 * authenticated/private route tree (mirrors app/(app)/*, app/super-admin/*,
 * app/supplier-portal/*, plus /login and /impersonate) so crawlers don't
 * waste budget on pages that 404-or-redirect for a signed-out crawler
 * anyway and hold no public content. The real, indexable surface is just
 * "/" and "/register" — matches the noindex `robots` metadata each of
 * those private route trees sets on itself (defense in depth: this file
 * stops crawl attempts, the meta tag stops indexing if a link to one of
 * them ever gets crawled some other way).
 */
export default function robots(): MetadataRoute.Robots {
  return {
    rules: {
      userAgent: '*',
      allow: '/',
      disallow: [
        '/dashboard',
        '/catalog',
        '/inventory',
        '/bom',
        '/production',
        '/procurement',
        '/sales',
        '/hr',
        '/reports',
        '/ai',
        '/notifications',
        '/billing',
        '/settings',
        '/admin',
        '/planner',
        '/training',
        '/super-admin',
        '/supplier-portal',
        '/login',
        '/impersonate',
        '/api',
      ],
    },
    sitemap: `${SITE_URL}/sitemap.xml`,
  };
}
