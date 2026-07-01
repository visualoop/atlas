import type { MetadataRoute } from "next";

const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL ?? "https://atlas.blyss.co.ke";

export default function sitemap(): MetadataRoute.Sitemap {
  const now = new Date();
  // Atlas is primarily an authenticated product. Sitemap only lists
  // marketing surfaces that a search engine should crawl. Public
  // dynamic routes (/d/[token], /p/[wsSlug]/[pageSlug], /book/…) are
  // intentionally excluded — they carry per-tenant tokens.
  return [
    {
      url: SITE_URL,
      lastModified: now,
      changeFrequency: "weekly",
      priority: 1.0,
    },
    {
      url: `${SITE_URL}/login`,
      lastModified: now,
      changeFrequency: "monthly",
      priority: 0.3,
    },
  ];
}
