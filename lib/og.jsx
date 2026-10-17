// ============================================================
// OGP画像(1200×630)の部品(v21)
//   ・日本語フォント:Google Fonts から必要な文字だけ取得 → 失敗したら同梱フォント(assets/fonts)
//   ・商品画像は先に読み込んで埋め込む(失敗しても画像なしで描く)
//   ・楽天の規約(商品画像に文字を重ねない)に合わせ、文字はすべて画像の「外」に置く
//   ・Amazonの商品画像は加工・保存できないため使わない(代わりにアイコン)
//   ・価格は必ず3サイト(楽天・Yahoo!・Amazon)を並べ、最安を強調する
// ============================================================

import { readFile } from "node:fs/promises";
import { join } from "node:path";

export const OG_SIZE = { width: 1200, height: 630 };

const C = {
  navy: "#16324F", bg: "#F3F6F4", card: "#FFFFFF", line: "#DDE5E1", sub: "#5B6B7B",
  green: "#059669", greenBg: "#E7F8F0", gold: "#E3A008",
  rakuten: "#BF0000", yahoo: "#FF0033", amazon: "#232F3E",
};
const STORES = [["rakuten", "楽天"], ["yahoo", "Yahoo!"], ["amazon", "Amazon"]];
const yen = (n) => (n == null ? "—" : "¥" + Math.round(n).toLocaleString("ja-JP"));

// ---------- フォント ----------
let localFont = null;
async function loadLocalFont() {
  if (!localFont) localFont = await readFile(join(process.cwd(), "assets/fonts/NotoSansJP-Bold-subset.ttf"));
  return localFont;
}
async function loadGoogleFont(text) {
  const url = `https://fonts.googleapis.com/css2?family=Noto+Sans+JP:wght@700&text=${encodeURIComponent(text)}`;
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 2500);
  try {
    const css = await (await fetch(url, { signal: ctrl.signal })).text();
    const m = css.match(/src: url\((.+?)\) format\('(opentype|truetype)'\)/);
    if (!m) return null;
    const res = await fetch(m[1], { signal: ctrl.signal });
    return res.ok ? await res.arrayBuffer() : null;
  } catch {
    return null;
  } finally {
    clearTimeout(t);
  }
}
export async function ogFonts(text) {
  const uniq = [...new Set(String(text || "") + "0123456789¥,.%・〜()位選楽天Yahoo!Amazon最安時点の価格変動しますPR#oudanvercelapp")].join("");
  let data = process.env.OG_FONT_LOCAL_ONLY ? null : await loadGoogleFont(uniq);
  if (!data) data = await loadLocalFont();
  return [{ name: "NotoJP", data, weight: 700, style: "normal" }];
}

// ---------- 商品画像(先に読み込んで埋め込む) ----------
export async function imageData(url) {
  if (!url || /media-amazon|images-amazon|ssl-images-amazon/.test(url)) return null;
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 3500);
  try {
    const res = await fetch(url, { signal: ctrl.signal });
    if (!res.ok) return null;
    const type = res.headers.get("content-type") || "";
    if (!/image\/(jpeg|jpg|png|gif)/.test(type)) return null;
    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.length > 1500000) return null;
    return `data:${type.split(";")[0]};base64,${buf.toString("base64")}`;
  } catch {
    return null;
  } finally {
    clearTimeout(t);
  }
}

// ---------- 共通パーツ ----------
function ImgBox({ src, size, radius = 14 }) {
  return (
    <div style={{ width: size, height: size, flexShrink: 0, background: "#fff", border: `2px solid ${C.line}`, borderRadius: radius, display: "flex", alignItems: "center", justifyContent: "center", overflow: "hidden" }}>
      {src ? <img src={src} width={size - 12} height={size - 12} style={{ objectFit: "contain" }} /> : <div style={{ fontSize: Math.max(14, size * 0.12), color: "#B8C4CE", display: "flex" }}>画像なし</div>}
    </div>
  );
}

function cheapestOf(prices) {
  let best = null;
  for (const [s] of STORES) if (prices?.[s] != null && (best == null || prices[s] < prices[best])) best = s;
  return best;
}

// 3サイトの価格(縦に3行)
function PriceRows({ prices, size = 20 }) {
  const best = cheapestOf(prices);
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 3, width: "100%" }}>
      {STORES.map(([s, label]) => {
        const on = s === best;
        return (
          <div key={s} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "2px 8px", borderRadius: 8, background: on ? C.greenBg : "transparent", border: on ? `2px solid ${C.green}` : "2px solid transparent" }}>
            <div style={{ display: "flex", fontSize: size * 0.72, color: C[s], fontWeight: 700 }}>{label}</div>
            <div style={{ display: "flex", fontSize: size, color: prices?.[s] != null ? (on ? C.green : C.navy) : "#B8C4CE", fontWeight: 700 }}>{yen(prices?.[s])}</div>
          </div>
        );
      })}
    </div>
  );
}

function Header({ title, subtitle, kicker }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", background: C.navy, padding: "22px 40px 18px", color: "#fff" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
        {kicker && <div style={{ display: "flex", background: C.gold, color: C.navy, fontSize: 22, padding: "3px 14px", borderRadius: 8 }}>{kicker}</div>}
        <div style={{ display: "flex", marginLeft: "auto", fontSize: 22, opacity: 0.85 }}>オウダン|3サイト価格比較</div>
      </div>
      <div style={{ display: "flex", fontSize: title.length > 24 ? 40 : 48, lineHeight: 1.25, marginTop: 8, maxHeight: 122, overflow: "hidden" }}>{title}</div>
      {subtitle && <div style={{ display: "flex", fontSize: 22, opacity: 0.85, marginTop: 4, maxHeight: 30, overflow: "hidden" }}>{subtitle}</div>}
    </div>
  );
}

function Footer({ date }) {
  return (
    <div style={{ display: "flex", alignItems: "center", padding: "0 40px", height: 46, background: "#E9EEEB", color: C.sub, fontSize: 19 }}>
      <div style={{ display: "flex" }}>oudan.vercel.app</div>
      <div style={{ display: "flex", marginLeft: 20 }}>{date ? `${date}時点の価格(変動します)` : "価格は変動します"}</div>
      <div style={{ display: "flex", marginLeft: "auto", background: "#fff", border: `2px solid ${C.sub}`, borderRadius: 6, padding: "0 10px", fontSize: 18 }}>PR</div>
    </div>
  );
}

const clip = (s, n) => (String(s || "").length > n ? String(s).slice(0, n - 1) + "…" : String(s || ""));

// ---------- テンプレート ----------
//  data: { title, subtitle, template: "ranking"|"lineup"|"compare", date, items: [{ name, image, prices }] }
export function CollectionOG({ data }) {
  const items = (data.items || []).slice(0, 6);
  const n = Math.max(1, items.length);
  const tpl = data.template || "ranking";
  const kicker = tpl === "ranking" ? `TOP${n}` : tpl === "lineup" ? `${n}選` : "比較";
  const bodyH = 630 - 46 - (data.subtitle ? 176 : 146);

  let body;
  if (tpl === "compare") {
    const rowH = Math.floor((bodyH - 20 - 34) / n);
    const img = Math.min(rowH - 10, 84);
    const fs = rowH > 70 ? 22 : 18;
    body = (
      <div style={{ display: "flex", flexDirection: "column", padding: "10px 36px", gap: 0, flex: 1 }}>
        <div style={{ display: "flex", height: 34, alignItems: "center", fontSize: 18, color: C.sub }}>
          <div style={{ display: "flex", width: img + 14 }} />
          <div style={{ display: "flex", flex: 1 }}>商品</div>
          {STORES.map(([s, l]) => <div key={s} style={{ display: "flex", width: 168, justifyContent: "flex-end", color: C[s] }}>{l}</div>)}
        </div>
        {items.map((it, i) => {
          const best = cheapestOf(it.prices);
          return (
            <div key={i} style={{ display: "flex", alignItems: "center", height: rowH, borderTop: `2px solid ${C.line}`, background: i % 2 ? "#FAFCFB" : "#fff" }}>
              <div style={{ display: "flex", width: img + 14 }}><ImgBox src={it.image} size={img} radius={10} /></div>
              <div style={{ display: "flex", flex: 1, fontSize: fs, color: C.navy, lineHeight: 1.25, paddingRight: 10, maxHeight: rowH - 6, overflow: "hidden" }}>{clip(it.name, 44)}</div>
              {STORES.map(([s]) => (
                <div key={s} style={{ display: "flex", width: 168, justifyContent: "flex-end" }}>
                  <div style={{ display: "flex", fontSize: fs + 4, padding: "2px 10px", borderRadius: 8, color: it.prices?.[s] == null ? "#B8C4CE" : s === best ? C.green : C.navy, background: s === best ? C.greenBg : "transparent", border: s === best ? `2px solid ${C.green}` : "2px solid transparent" }}>
                    {yen(it.prices?.[s])}
                  </div>
                </div>
              ))}
            </div>
          );
        })}
      </div>
    );
  } else {
    const gap = 16;
    const cardW = Math.floor((1200 - 72 - gap * (n - 1)) / n);
    const nameFs = n <= 3 ? 22 : n === 4 ? 18 : 16;
    const priceFs = n <= 3 ? 24 : n === 4 ? 20 : 17;
    // カードの高さに収まるよう、画像の大きさを残りの高さから決める(名前と価格は必ず見せる)
    const inner = bodyH - 26 - 22;
    const nameH = Math.round(nameFs * 1.35 * 2) + 12;
    const priceH = 3 * Math.round(priceFs * 1.35 + 10) + 10;
    // 2行に収まる文字数(全角換算。英数字は半分の幅として数える)
    const perLine = Math.floor((cardW - 26) / nameFs);
    const fit2 = (name) => {
      let w = 0, out = "";
      for (const ch of String(name || "")) {
        const cw = /[\x20-\x7E]/.test(ch) ? 0.55 : 1;
        if (w + cw > perLine * 2 - 1.2) return out + "…";
        w += cw; out += ch;
      }
      return out;
    };
    const img = Math.max(64, Math.min(cardW - 28, inner - 40 - nameH - priceH));
    const medal = ["#E3A008", "#9CA3AF", "#B7791F"];
    body = (
      <div style={{ display: "flex", padding: "14px 36px 12px", gap, flex: 1 }}>
        {items.map((it, i) => (
          <div key={i} style={{ display: "flex", flexDirection: "column", alignItems: "center", width: cardW, background: C.card, border: `2px solid ${C.line}`, borderRadius: 18, padding: "10px 10px 10px" }}>
            <div style={{ display: "flex", width: "100%", alignItems: "center", marginBottom: 6, height: 34 }}>
              {tpl === "ranking" ? (
                <div style={{ display: "flex", alignItems: "center", justifyContent: "center", minWidth: 64, height: 34, borderRadius: 17, background: medal[i] || C.navy, color: "#fff", fontSize: 22 }}>{i + 1}位</div>
              ) : (
                <div style={{ display: "flex", alignItems: "center", justifyContent: "center", minWidth: 34, height: 34, borderRadius: 17, background: C.navy, color: "#fff", fontSize: 18 }}>{i + 1}</div>
              )}
            </div>
            <ImgBox src={it.image} size={img} />
            <div style={{ display: "flex", flexShrink: 0, fontSize: nameFs, color: C.navy, lineHeight: 1.3, marginTop: 8, height: nameH - 8, overflow: "hidden", width: "100%" }}>{fit2(it.name)}</div>
            <div style={{ display: "flex", flexShrink: 0, marginTop: "auto", width: "100%" }}><PriceRows prices={it.prices} size={priceFs} /></div>
          </div>
        ))}
      </div>
    );
  }

  return (
    <div style={{ width: 1200, height: 630, display: "flex", flexDirection: "column", background: C.bg, fontFamily: "NotoJP" }}>
      <Header title={clip(data.title, 44)} subtitle={data.subtitle ? clip(data.subtitle, 50) : ""} kicker={kicker} />
      {body}
      <Footer date={data.date} />
    </div>
  );
}

// 商品ページ用(1商品・3サイト比較を大きく)
export function ProductOG({ data }) {
  const best = cheapestOf(data.prices);
  return (
    <div style={{ width: 1200, height: 630, display: "flex", flexDirection: "column", background: C.bg, fontFamily: "NotoJP" }}>
      <div style={{ display: "flex", alignItems: "center", background: C.navy, color: "#fff", padding: "16px 40px", fontSize: 24 }}>
        <div style={{ display: "flex" }}>どこが安い?3サイト価格比較</div>
        <div style={{ display: "flex", marginLeft: "auto", opacity: 0.85 }}>オウダン</div>
      </div>
      <div style={{ display: "flex", flex: 1, padding: "26px 40px", gap: 34 }}>
        <ImgBox src={data.image} size={330} radius={22} />
        <div style={{ display: "flex", flexDirection: "column", flex: 1 }}>
          <div style={{ display: "flex", fontSize: 36, color: C.navy, lineHeight: 1.3, maxHeight: 142, overflow: "hidden" }}>{clip(data.name, 46)}</div>
          {data.statLine && (
            <div style={{ display: "flex", marginTop: 10, fontSize: 24, color: C.green, background: C.greenBg, borderRadius: 10, padding: "4px 14px", alignSelf: "flex-start" }}>{data.statLine}</div>
          )}
          <div style={{ display: "flex", flexDirection: "column", gap: 8, marginTop: "auto" }}>
            {STORES.map(([s, l]) => {
              const on = s === best;
              return (
                <div key={s} style={{ display: "flex", alignItems: "center", padding: "6px 18px", borderRadius: 12, background: on ? C.greenBg : "#fff", border: on ? `3px solid ${C.green}` : `2px solid ${C.line}` }}>
                  <div style={{ display: "flex", fontSize: 28, color: C[s], width: 170 }}>{l}</div>
                  {on && <div style={{ display: "flex", fontSize: 20, color: "#fff", background: C.green, borderRadius: 6, padding: "2px 10px" }}>最安</div>}
                  <div style={{ display: "flex", marginLeft: "auto", fontSize: 40, color: data.prices?.[s] == null ? "#B8C4CE" : on ? C.green : C.navy }}>{yen(data.prices?.[s])}</div>
                </div>
              );
            })}
          </div>
        </div>
      </div>
      <Footer date={data.date} />
    </div>
  );
}

// 「10/17 17:05」
export function jstStamp(d = new Date()) {
  const j = new Date(new Date(d).getTime() + 9 * 3600 * 1000);
  return `${j.getUTCMonth() + 1}/${j.getUTCDate()} ${String(j.getUTCHours()).padStart(2, "0")}:${String(j.getUTCMinutes()).padStart(2, "0")}`;
}
