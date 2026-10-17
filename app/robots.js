import { SITE } from "../lib/supabaseServer";

export default function robots() {
  return {
    rules: [{ userAgent: "*", allow: "/", disallow: ["/crawl", "/api/", "/collections"] }],
    sitemap: `${SITE}/sitemap.xml`,
  };
}
