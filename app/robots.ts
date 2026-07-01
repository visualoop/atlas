import type { MetadataRoute } from "next";

const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL ?? "https://atlas.blyss.co.ke";

export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      {
        userAgent: "*",
        allow: "/",
        disallow: [
          "/settings/",
          "/inbox",
          "/contacts",
          "/companies",
          "/pipelines",
          "/documents",
          "/campaigns",
          "/social",
          "/content",
          "/trends",
          "/analytics",
          "/calendar",
          "/prospector",
          "/vault",
          "/today",
        ],
      },
    ],
    sitemap: `${SITE_URL}/sitemap.xml`,
    host: SITE_URL,
  };
}
