// サイトマップ(v19):人気の商品ページを Google に知らせる(1日1回作り直す)
import { publicDb, SITE } from "../lib/supabaseServer";
import { productPath } from "../lib/priceView";

export const revalidate = 86400;
const MAX = 20000;

export default async function sitemap() {
  const urls = [
    { url: SITE + "/", changeFrequency: "daily", priority: 1 },
    { url: SITE + "/privacy", changeFrequency: "yearly", priority: 0.1 },
  ];
  try {
    const sb = publicDb();
    // 商品まとめ(先に入れる)
    urls.push({ url: SITE + "/c", changeFrequency: "daily", priority: 0.8 });
    const { data: cols } = await sb.from("collections").select("slug, updated_at").eq("is_public", true).order("updated_at", { ascending: false }).limit(1000);
    for (const c of cols || []) urls.push({ url: `${SITE}/c/${c.slug}`, lastModified: c.updated_at, changeFrequency: "weekly", priority: 0.7 });
    // 人気(ランキング入り)→ 有名ブランド の順に、最大2万件
    for (const pass of ["pop", "brand"]) {
      for (let from = 0; from < MAX && urls.length < MAX; from += 1000) {
        let q = sb.from("products").select("pkey, last_seen").is("merged_into", null);
        q = pass === "pop" ? q.not("pop", "is", null).order("pop", { ascending: true }) : q.is("pop", null).eq("is_brand", true).order("last_seen", { ascending: false });
        const { data, error } = await q.range(from, from + 999);
        if (error || !data || data.length === 0) break;
        for (const r of data) urls.push({ url: SITE + productPath(r.pkey), lastModified: r.last_seen, changeFrequency: "daily", priority: 0.6 });
        if (data.length < 1000) break;
      }
    }
  } catch {}
  return urls.slice(0, MAX);
}
