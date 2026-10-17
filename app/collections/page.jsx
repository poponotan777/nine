"use client";
// ============================================================
// 商品まとめの作成(運営専用)v21 /collections
//   ・合言葉(Vercel の ADMIN_KEY)を入れた人だけが作成・編集・削除できる
//   ・テンプレート3種:TOP N(順位つき)/ 横並び N選 / 比較リスト
//   ・商品は2〜6個。自動取得のDB(3サイトの価格)から選ぶ
//   ・保存すると共有URLとOGP画像(1200×630)が自動でできる
// ============================================================

import { useEffect, useState } from "react";
import { supabase } from "../../lib/supabaseClient";
import { loadCatalog } from "../../lib/catalog";
import { STORE_ORDER, STORE_META, yen } from "../../lib/priceView";
import { COLLECTIONS_ON } from "../../lib/featureFlags";

const TEMPLATES = [
  { id: "ranking", label: "TOP N(順位つき)", desc: "1位・2位…とメダル付きで並べる。おすすめ順を伝えたいとき" },
  { id: "lineup", label: "横並び N選", desc: "順位なしで並べる。「◯◯なら この3つ」系" },
  { id: "compare", label: "比較リスト", desc: "3サイトの価格を表で比べる。どこが安いかを見せたいとき" },
];

const box = { background: "#fff", border: "1px solid #DDE9E4", borderRadius: 14, padding: 16, marginBottom: 14 };
const input = { width: "100%", boxSizing: "border-box", border: "1px solid #CBD5E1", borderRadius: 8, padding: "9px 12px", fontSize: 16, outline: "none" };
const btn = (bg = "#16324F", color = "#fff") => ({ background: bg, color, border: bg === "#fff" ? "1.5px solid #16324F" : "none", borderRadius: 8, padding: "9px 14px", fontSize: 13, fontWeight: 800, cursor: "pointer" });

const EMPTY = { id: null, slug: null, title: "", subtitle: "", description: "", author_name: "", template: "ranking", is_public: true };

function pricesOf(entry) {
  const p = {};
  for (const s of STORE_ORDER) p[s] = entry?.offers?.[s]?.price ?? null;
  return p;
}

function Mini({ prices }) {
  let best = null;
  for (const s of STORE_ORDER) if (prices?.[s] != null && (best == null || prices[s] < prices[best])) best = s;
  return (
    <div style={{ display: "flex", gap: 6, fontSize: 11, marginTop: 3, flexWrap: "wrap" }}>
      {STORE_ORDER.map((s) => (
        <span key={s} style={{ color: STORE_META[s].color, fontWeight: 800, background: s === best ? "#ECFDF5" : "transparent", borderRadius: 4, padding: "0 4px" }}>
          {STORE_META[s].short} <span style={{ color: prices?.[s] == null ? "#CBD5E1" : "#16324F" }}>{yen(prices?.[s])}</span>
        </span>
      ))}
    </div>
  );
}

export default function CollectionsAdmin() {
  const [key, setKey] = useState("");
  const [authed, setAuthed] = useState(false);
  const [list, setList] = useState([]);
  const [col, setCol] = useState(null);
  const [items, setItems] = useState([]);
  const [q, setQ] = useState("");
  const [found, setFound] = useState([]);
  const [searching, setSearching] = useState(false);
  const [msg, setMsg] = useState("");
  const [preview, setPreview] = useState("");
  const [saved, setSaved] = useState(null);
  const [busy, setBusy] = useState(false);

  const api = async (action, extra = {}) => {
    const res = await fetch("/api/admin/collections", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ key, action, ...extra }) });
    const j = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(j.error || `HTTP ${res.status}`);
    return j;
  };

  const login = async (k = key) => {
    setMsg("");
    try {
      const res = await fetch("/api/admin/collections", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ key: k, action: "list" }) });
      const j = await res.json();
      if (!res.ok) throw new Error(j.error || "ログインできません");
      setList(j.collections || []);
      setAuthed(true);
      try { sessionStorage.setItem("oudanAdminKey", k); } catch {}
    } catch (e) { setMsg(String(e.message || e)); }
  };

  useEffect(() => {
    try { const k = sessionStorage.getItem("oudanAdminKey"); if (k) { setKey(k); login(k); } } catch {}
  }, []);

  const refresh = async () => { try { setList((await api("list")).collections || []); } catch (e) { setMsg(e.message); } };

  const startNew = () => { setCol({ ...EMPTY }); setItems([]); setPreview(""); setSaved(null); setMsg(""); };
  const edit = async (c) => {
    try {
      const j = await api("get", { id: c.id });
      setCol({ ...EMPTY, ...j.collection });
      const keys = (j.items || []).map((i) => i.product_key);
      const cat = await loadCatalog(supabase, keys).catch(() => new Map());
      setItems((j.items || []).map((i) => ({ product_key: i.product_key, name: i.name, image: i.image, headline: i.headline || "", comment: i.comment || "", prices: pricesOf(cat.get(i.product_key)) })));
      setPreview(""); setSaved(null); setMsg("");
      window.scrollTo(0, 0);
    } catch (e) { setMsg(e.message); }
  };
  const remove = async (c) => {
    if (!window.confirm(`「${c.title}」を削除します。よろしいですか?`)) return;
    try { await api("delete", { id: c.id }); refresh(); if (col?.id === c.id) setCol(null); } catch (e) { setMsg(e.message); }
  };

  // DB(3サイトの価格)から商品を探す
  const search = async () => {
    const kw = q.trim();
    if (!kw) return;
    setSearching(true);
    try {
      const words = kw.split(/\s+/).filter(Boolean).slice(0, 4);
      let query = supabase.from("products").select("pkey, name, image, brand, pop").is("merged_into", null);
      for (const w of words) query = query.ilike("name", `%${w}%`);
      const { data } = await query.order("pop", { ascending: true, nullsFirst: false }).limit(30);
      const cat = await loadCatalog(supabase, (data || []).map((p) => p.pkey)).catch(() => new Map());
      setFound((data || []).map((p) => ({ ...p, prices: pricesOf(cat.get(p.pkey)), stores: Object.keys(cat.get(p.pkey)?.offers || {}).length })));
    } catch { setFound([]); }
    setSearching(false);
  };

  const add = (p) => {
    if (items.length >= 6) return setMsg("商品は6個までです");
    if (items.some((i) => i.product_key === p.pkey)) return;
    setItems([...items, { product_key: p.pkey, name: p.name, image: p.image, headline: "", comment: "", prices: p.prices }]);
    setMsg("");
  };
  const move = (i, d) => {
    const j = i + d;
    if (j < 0 || j >= items.length) return;
    const next = [...items];
    [next[i], next[j]] = [next[j], next[i]];
    setItems(next);
  };
  const setItem = (i, k, v) => setItems(items.map((it, x) => (x === i ? { ...it, [k]: v } : it)));

  const doPreview = async () => {
    setBusy(true);
    try {
      const res = await fetch("/api/admin/og-preview", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ key, data: { title: col.title, subtitle: col.subtitle, template: col.template, items } }) });
      if (!res.ok) throw new Error("プレビューを作れませんでした");
      const blob = await res.blob();
      setPreview(URL.createObjectURL(blob));
    } catch (e) { setMsg(e.message); }
    setBusy(false);
  };

  const save = async () => {
    if (!col.title.trim()) return setMsg("タイトルを入れてください");
    if (items.length < 2 || items.length > 6) return setMsg("商品は2〜6個にしてください");
    setBusy(true);
    try {
      const j = await api("save", { collection: col, items });
      setCol({ ...col, id: j.id, slug: j.slug });
      setSaved({ slug: j.slug });
      setMsg("保存しました");
      refresh();
    } catch (e) { setMsg(e.message); }
    setBusy(false);
  };

  if (!COLLECTIONS_ON) return <div style={{ padding: 40, textAlign: "center" }}>この機能は準備中です。</div>;

  const shareUrl = saved?.slug && typeof window !== "undefined" ? `${window.location.origin}/c/${saved.slug}` : "";
  const tweet = shareUrl ? `${col.title}\n\n楽天・Yahoo!・Amazonで今いちばん安いのはどこ?👇\n${shareUrl}\n\n#PR` : "";

  return (
    <div style={{ minHeight: "100vh", background: "#F0F6F4", fontFamily: "'Hiragino Sans','Noto Sans JP',sans-serif", color: "#16324F" }}>
      <header style={{ background: "#16324F", padding: "12px 16px", color: "#fff", fontWeight: 800 }}>
        <div className="oud-wrap">オウダン|商品まとめを作る(運営専用)</div>
      </header>
      <main className="oud-wrap" style={{ padding: 16 }}>
        {!authed ? (
          <div style={box}>
            <div style={{ fontSize: 14, fontWeight: 800, marginBottom: 8 }}>合言葉</div>
            <input type="password" value={key} onChange={(e) => setKey(e.target.value)} onKeyDown={(e) => e.key === "Enter" && login()} style={input} />
            <button onClick={() => login()} style={{ ...btn(), marginTop: 10, width: "100%" }}>入る</button>
            {msg && <p style={{ color: "#B91C1C", fontSize: 12.5 }}>{msg}</p>}
          </div>
        ) : (
          <>
            {!col && (
              <div style={box}>
                <div style={{ display: "flex", alignItems: "center", marginBottom: 10 }}>
                  <div style={{ fontSize: 15, fontWeight: 800 }}>作ったまとめ</div>
                  <button onClick={startNew} style={{ ...btn("#10B981"), marginLeft: "auto" }}>+ 新しく作る</button>
                </div>
                {list.length === 0 && <p style={{ fontSize: 12.5, color: "#64748B" }}>まだありません。</p>}
                {list.map((c) => (
                  <div key={c.id} style={{ display: "flex", alignItems: "center", gap: 8, borderTop: "1px solid #E2E8F0", padding: "10px 0" }}>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: 13.5, fontWeight: 800 }}>{c.title}</div>
                      <div style={{ fontSize: 11, color: "#64748B" }}>{TEMPLATES.find((t) => t.id === c.template)?.label} ・ {c.is_public ? "公開" : "非公開"} ・ <a href={`/c/${c.slug}`} target="_blank" rel="noreferrer">/c/{c.slug} ↗</a></div>
                    </div>
                    <button onClick={() => edit(c)} style={btn("#fff", "#16324F")}>編集</button>
                    <button onClick={() => remove(c)} style={{ ...btn("#fff", "#B91C1C"), border: "1px solid #FCA5A5" }}>削除</button>
                  </div>
                ))}
                {msg && <p style={{ color: "#B91C1C", fontSize: 12.5 }}>{msg}</p>}
              </div>
            )}

            {col && (
              <>
                <button onClick={() => { setCol(null); refresh(); }} style={{ background: "none", border: "none", color: "#64748B", fontWeight: 700, cursor: "pointer", padding: "0 0 10px" }}>← 一覧に戻る</button>

                <div style={box}>
                  <div style={{ fontSize: 14, fontWeight: 800, marginBottom: 8 }}>① テンプレート</div>
                  <div className="oud-grid">
                    {TEMPLATES.map((t) => (
                      <button key={t.id} onClick={() => setCol({ ...col, template: t.id })}
                        style={{ textAlign: "left", background: col.template === t.id ? "#ECFDF5" : "#fff", border: col.template === t.id ? "2px solid #10B981" : "1px solid #CBD5E1", borderRadius: 12, padding: 12, cursor: "pointer" }}>
                        <div style={{ fontSize: 13.5, fontWeight: 800 }}>{t.label}</div>
                        <div style={{ fontSize: 11.5, color: "#64748B", marginTop: 2 }}>{t.desc}</div>
                      </button>
                    ))}
                  </div>
                </div>

                <div style={box}>
                  <div style={{ fontSize: 14, fontWeight: 800, marginBottom: 8 }}>② タイトルと説明</div>
                  <input value={col.title} onChange={(e) => setCol({ ...col, title: e.target.value })} placeholder="例:乾燥肌さんに本気でおすすめの保湿クリーム TOP3" maxLength={80} style={input} />
                  <div style={{ fontSize: 10.5, color: "#94A3B8", margin: "3px 0 8px" }}>{col.title.length}/80(OGP画像には44文字まで入ります)</div>
                  <input value={col.subtitle || ""} onChange={(e) => setCol({ ...col, subtitle: e.target.value })} placeholder="サブタイトル(画像の下段に出ます)例:3サイトの最安をまとめて比較" maxLength={160} style={input} />
                  <textarea value={col.description || ""} onChange={(e) => setCol({ ...col, description: e.target.value })} placeholder="本文(ページの最初に出る説明。選んだ理由など)" rows={4} style={{ ...input, marginTop: 8, resize: "vertical" }} />
                  <div style={{ display: "flex", gap: 10, marginTop: 8, alignItems: "center", flexWrap: "wrap" }}>
                    <input value={col.author_name || ""} onChange={(e) => setCol({ ...col, author_name: e.target.value })} placeholder="作成者名(空欄=オウダン編集部)" maxLength={40} style={{ ...input, flex: 1, minWidth: 200 }} />
                    <label style={{ fontSize: 13 }}><input type="checkbox" checked={col.is_public !== false} onChange={(e) => setCol({ ...col, is_public: e.target.checked })} /> 公開する</label>
                  </div>
                </div>

                <div style={box}>
                  <div style={{ fontSize: 14, fontWeight: 800, marginBottom: 8 }}>③ 商品を選ぶ(2〜6個)</div>
                  <div style={{ display: "flex", gap: 8 }}>
                    <input value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={(e) => e.key === "Enter" && search()} placeholder="商品名で探す(自動取得したDBから)" style={input} />
                    <button onClick={search} style={{ ...btn(), whiteSpace: "nowrap" }}>{searching ? "…" : "探す"}</button>
                  </div>
                  {found.length > 0 && (
                    <div style={{ maxHeight: 360, overflowY: "auto", marginTop: 10, borderTop: "1px solid #E2E8F0" }}>
                      {found.map((p) => (
                        <div key={p.pkey} style={{ display: "flex", gap: 10, alignItems: "center", borderBottom: "1px solid #F1F5F9", padding: "8px 0" }}>
                          {p.image ? <img src={p.image} alt="" style={{ width: 48, height: 48, objectFit: "contain", background: "#F3F6F4", borderRadius: 8 }} /> : <div style={{ width: 48, height: 48, background: "#F3F6F4", borderRadius: 8 }} />}
                          <div style={{ flex: 1, minWidth: 0 }}>
                            <div style={{ fontSize: 12.5, fontWeight: 700, lineHeight: 1.35 }}>{p.name}</div>
                            <Mini prices={p.prices} />
                          </div>
                          <button onClick={() => add(p)} disabled={items.some((i) => i.product_key === p.pkey)} style={btn("#10B981")}>追加</button>
                        </div>
                      ))}
                    </div>
                  )}
                  {found.length === 0 && q && !searching && <p style={{ fontSize: 11.5, color: "#94A3B8" }}>見つからないときは、短い言葉(ブランド名など)で探してください。</p>}
                </div>

                <div style={box}>
                  <div style={{ fontSize: 14, fontWeight: 800, marginBottom: 8 }}>④ 並び順・ひとこと({items.length}/6)</div>
                  {items.length === 0 && <p style={{ fontSize: 12.5, color: "#94A3B8" }}>上で商品を追加してください。</p>}
                  {items.map((it, i) => (
                    <div key={it.product_key} style={{ borderTop: i ? "1px solid #E2E8F0" : "none", padding: "10px 0" }}>
                      <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
                        <div style={{ fontSize: 13, fontWeight: 900, color: "#fff", background: "#16324F", borderRadius: 999, padding: "2px 9px" }}>{i + 1}</div>
                        {it.image ? <img src={it.image} alt="" style={{ width: 40, height: 40, objectFit: "contain", background: "#F3F6F4", borderRadius: 6 }} /> : null}
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={{ fontSize: 12.5, fontWeight: 700 }}>{it.name}</div>
                          <Mini prices={it.prices} />
                        </div>
                        <button onClick={() => move(i, -1)} style={btn("#fff", "#16324F")}>↑</button>
                        <button onClick={() => move(i, 1)} style={btn("#fff", "#16324F")}>↓</button>
                        <button onClick={() => setItems(items.filter((_, x) => x !== i))} style={{ ...btn("#fff", "#B91C1C"), border: "1px solid #FCA5A5" }}>×</button>
                      </div>
                      <input value={it.headline} onChange={(e) => setItem(i, "headline", e.target.value)} placeholder="見出し(30字まで)例:コスパ最強・迷ったらこれ" maxLength={30} style={{ ...input, marginTop: 8 }} />
                      <textarea value={it.comment} onChange={(e) => setItem(i, "comment", e.target.value)} placeholder="ひとこと解説(使ってみた感想・選んだ理由など)" rows={2} maxLength={400} style={{ ...input, marginTop: 6, resize: "vertical" }} />
                    </div>
                  ))}
                </div>

                <div style={box}>
                  <div style={{ fontSize: 14, fontWeight: 800, marginBottom: 8 }}>⑤ OGP画像と保存</div>
                  <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                    <button onClick={doPreview} disabled={busy || items.length < 1} style={btn("#fff", "#16324F")}>OGP画像をプレビュー</button>
                    <button onClick={save} disabled={busy} style={btn("#10B981")}>{col.id ? "更新して保存" : "保存して公開URLを作る"}</button>
                  </div>
                  {preview && <img src={preview} alt="OGPプレビュー" style={{ width: "100%", marginTop: 12, borderRadius: 10, border: "1px solid #E2E8F0" }} />}
                  {msg && <p style={{ fontSize: 12.5, color: msg === "保存しました" ? "#059669" : "#B91C1C", fontWeight: 700 }}>{msg}</p>}
                  {saved && (
                    <div style={{ background: "#ECFDF5", border: "1px solid #10B981", borderRadius: 10, padding: 12, marginTop: 10 }}>
                      <div style={{ fontSize: 12.5, fontWeight: 800 }}>公開URL</div>
                      <a href={shareUrl} target="_blank" rel="noreferrer" style={{ fontSize: 13, wordBreak: "break-all" }}>{shareUrl}</a>
                      <div style={{ display: "flex", gap: 8, marginTop: 10, flexWrap: "wrap" }}>
                        <a href={`https://x.com/intent/post?text=${encodeURIComponent(tweet)}`} target="_blank" rel="noreferrer" style={{ ...btn("#000"), textDecoration: "none" }}>Xで投稿する</a>
                        <button onClick={() => navigator.clipboard.writeText(tweet)} style={btn("#fff", "#16324F")}>投稿文をコピー</button>
                      </div>
                      <p style={{ fontSize: 10.5, color: "#065F46", margin: "8px 0 0", lineHeight: 1.6 }}>
                        Xに貼ると、このURLのOGP画像(3サイトの価格つき)がカードで表示されます。広告なので本文に #PR を必ず入れてください。
                      </p>
                    </div>
                  )}
                </div>
              </>
            )}
          </>
        )}
      </main>
    </div>
  );
}
