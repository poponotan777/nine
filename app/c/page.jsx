// 商品まとめの一覧(v21)
import { COLLECTIONS_ON } from "../../lib/featureFlags";
import { publicDb } from "../../lib/supabaseServer";
import { fmtTime } from "../../lib/priceView";

export const revalidate = 600;
export const metadata = { title: "商品まとめ一覧 | オウダン", description: "楽天・Yahoo!・Amazonの価格を比べた商品まとめ(ランキング・◯選・比較)", alternates: { canonical: "/c" } };

export default async function CollectionsIndex() {
  if (!COLLECTIONS_ON) return <div style={{ padding: 40, textAlign: "center" }}>準備中です。</div>;
  const { data } = await publicDb().from("collections").select("slug, title, subtitle, template, updated_at").eq("is_public", true).order("updated_at", { ascending: false }).limit(100);
  const list = data || [];
  const T = { ranking: "ランキング", lineup: "◯選", compare: "比較" };
  return (
    <div style={{ minHeight: "100vh", background: "#F0F6F4", fontFamily: "'Hiragino Sans','Noto Sans JP',sans-serif", color: "#16324F" }}>
      <header style={{ background: "#16324F", padding: "12px 16px" }}>
        <div className="oud-wrap"><a href="/" style={{ color: "#fff", fontWeight: 800, fontSize: 17, textDecoration: "none" }}>オウダン</a></div>
      </header>
      <main className="oud-wrap" style={{ padding: 16 }}>
        <h1 style={{ fontSize: 20, fontWeight: 900 }}>商品まとめ</h1>
        {list.length === 0 && <p style={{ color: "#64748B", fontSize: 13 }}>まだありません。</p>}
        <div className="oud-grid">
          {list.map((c) => (
            <a key={c.slug} href={`/c/${c.slug}`} style={{ display: "block", background: "#fff", border: "1px solid #DDE9E4", borderRadius: 14, padding: 14, textDecoration: "none", color: "#16324F" }}>
              <img src={`/c/${c.slug}/opengraph-image`} alt="" style={{ width: "100%", aspectRatio: "1200/630", objectFit: "cover", borderRadius: 10, background: "#E9EEEB" }} />
              <div style={{ fontSize: 10.5, fontWeight: 800, color: "#B45309", marginTop: 8 }}>{T[c.template] || ""}</div>
              <div style={{ fontSize: 15, fontWeight: 800, lineHeight: 1.4 }}>{c.title}</div>
              {c.subtitle && <div style={{ fontSize: 12, color: "#64748B", marginTop: 2 }}>{c.subtitle}</div>}
              <div style={{ fontSize: 10.5, color: "#94A3B8", marginTop: 4 }}>{fmtTime(c.updated_at).split(" ")[0]}更新</div>
            </a>
          ))}
        </div>
      </main>
    </div>
  );
}
