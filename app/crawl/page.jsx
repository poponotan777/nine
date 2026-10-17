"use client";
// ============================================================
// 運営ページ(v23)/crawl
//   以前の「ブラウザで開いて動かすクローラー」は、v18 の自動取得(GitHub Actions)に置き換えたので廃止。
//   ここでは:①自動取得の状況とDB容量 ②セール情報の取り込み ③セール日程の手動登録 ④まとめ作成へのリンク
//   合言葉は Vercel の ADMIN_KEY(ブラウザには配られない)。未設定なら旧 NEXT_PUBLIC_CRAWL_KEY
// ============================================================

import { useEffect, useState } from "react";

const NAMES = { rakuten: "楽天", yahoo: "Yahoo!", amazon: "Amazon" };
const fmt = (iso) => {
  if (!iso) return "";
  const j = new Date(new Date(iso).getTime() + 9 * 3600 * 1000);
  return `${j.getUTCMonth() + 1}/${j.getUTCDate()} ${String(j.getUTCHours()).padStart(2, "0")}:${String(j.getUTCMinutes()).padStart(2, "0")}`;
};

export default function AdminConsole() {
  const [key, setKey] = useState("");
  const [authed, setAuthed] = useState(false);
  const [status, setStatus] = useState(null);
  const [msg, setMsg] = useState("");
  const [saleForm, setSaleForm] = useState({ name: "", store: "rakuten", start_date: "", end_date: "", url: "" });
  const [saleMsg, setSaleMsg] = useState("");
  const [sheetUrl, setSheetUrl] = useState("");
  const [sheetMsg, setSheetMsg] = useState("");

  const load = async (k = key) => {
    setMsg("");
    try {
      const res = await fetch("/api/admin/status", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ key: k }) });
      const j = await res.json();
      if (!res.ok) throw new Error(j.error || "入れませんでした");
      setStatus(j);
      setAuthed(true);
      try { sessionStorage.setItem("oudanAdminKey", k); } catch {}
    } catch (e) { setMsg(String(e.message || e)); }
  };
  useEffect(() => {
    try { const k = sessionStorage.getItem("oudanAdminKey"); if (k) { setKey(k); load(k); } } catch {}
  }, []);

  if (!authed) {
    return (
      <div style={wrap}>
        <h1 style={{ fontSize: 18 }}>オウダン 運営ページ</h1>
        <input type="password" value={key} onChange={(e) => setKey(e.target.value)} onKeyDown={(e) => e.key === "Enter" && load()} placeholder="合言葉" style={inp} />
        <button onClick={() => load()} style={{ ...btn("#16324F"), marginTop: 10, width: "100%" }}>入る</button>
        {msg && <p style={{ color: "#B91C1C", fontSize: 12.5 }}>{msg}</p>}
      </div>
    );
  }

  const mb = status?.usage?.db_bytes ? status.usage.db_bytes / 1024 / 1024 : null;
  const pct = mb != null ? Math.min(100, Math.round((mb / 500) * 100)) : 0;
  return (
    <div style={wrap}>
      <h1 style={{ fontSize: 18, marginBottom: 4 }}>オウダン 運営ページ</h1>
      <a href="/collections" style={{ fontSize: 13, fontWeight: 700 }}>→ 商品まとめを作る</a>

      {/* ① 自動取得とDB */}
      <h2 style={h2}>🤖 自動取得の状況(1日2回・5時/17時)</h2>
      {mb != null && (
        <div style={{ marginBottom: 10 }}>
          <div style={{ fontSize: 13, fontWeight: 800 }}>DB容量:{mb.toFixed(1)}MB / 500MB(無料枠)</div>
          <div style={{ height: 10, background: "#E2E8F0", borderRadius: 999, overflow: "hidden", marginTop: 4 }}>
            <div style={{ width: `${pct}%`, height: "100%", background: pct >= 80 ? "#DC2626" : pct >= 60 ? "#F59E0B" : "#10B981" }} />
          </div>
          <div style={{ fontSize: 11.5, color: "#64748B", marginTop: 4 }}>
            商品 {status.usage.products?.toLocaleString()}件・価格行 {status.usage.offers?.toLocaleString()}件・他サイト補完待ち {status.usage.queue?.toLocaleString()}件
            {pct >= 80 && <b style={{ color: "#DC2626" }}> ← 有料プラン(Supabase Pro)への切り替えを検討する目安です</b>}
          </div>
        </div>
      )}
      <div style={{ overflowX: "auto" }}>
        <table style={{ borderCollapse: "collapse", width: "100%", fontSize: 12 }}>
          <thead><tr style={{ background: "#F1F5F9" }}><th style={th}>開始</th><th style={th}>回</th><th style={th}>サイト</th><th style={th}>リクエスト</th><th style={th}>書き込み</th><th style={th}>エラー</th><th style={th}>メモ</th></tr></thead>
          <tbody>
            {(status?.runs || []).map((r, i) => (
              <tr key={i} style={{ borderTop: "1px solid #E2E8F0" }}>
                <td style={td}>{fmt(r.started_at)}</td><td style={td}>{r.slot === "am" ? "午前" : "午後"}</td><td style={td}>{NAMES[r.store] || r.store}</td>
                <td style={td}>{r.requests}</td><td style={{ ...td, color: r.items ? "#065F46" : "#B91C1C", fontWeight: 700 }}>{r.items}</td>
                <td style={{ ...td, color: r.errors ? "#B91C1C" : "#64748B" }}>{r.errors}</td><td style={{ ...td, color: "#64748B" }}>{r.note}</td>
              </tr>
            ))}
            {(status?.runs || []).length === 0 && <tr><td colSpan={7} style={{ ...td, color: "#94A3B8" }}>まだ実行記録がありません(GitHub の Actions で1回動かすと出ます)</td></tr>}
          </tbody>
        </table>
      </div>
      <button onClick={() => load()} style={{ ...btn("#fff"), color: "#16324F", border: "1.5px solid #16324F", marginTop: 8 }}>更新</button>

      {/* ② スプレッドシートから一括取り込み */}
      <h2 style={h2}>📊 スプレッドシートからセール情報を更新</h2>
      <p style={note}>
        <b>シートの列(1行目は見出し):</b> A:ステータス / B:対象サイト / C:セール名 / D:期間 / E:概要 / F:URL<br />
        ・シート右上「共有」→「リンクを知っている全員」→「閲覧者」<br />
        ・取り込んだセールは「確定」として表示され、同じセールの予想は自動で消えます<br />
        <b>※取り込むと既存のセール情報は置き換わります(シートが正)。</b>
      </p>
      <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
        <input value={sheetUrl} onChange={(e) => setSheetUrl(e.target.value)} placeholder="https://docs.google.com/spreadsheets/d/..." style={{ ...inp, flex: 1 }} />
        <button
          onClick={async () => {
            setSheetMsg("取り込み中…");
            try {
              const res = await fetch("/api/admin/import-sales", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ sheetUrl, key }) }).then((r) => r.json());
              if (res.ok) {
                let m = `✅ ${res.imported}件を取り込みました(開催中${res.breakdown?.live ?? 0}件・今後${res.breakdown?.upcoming ?? 0}件)`;
                if (res.skippedDetail?.length) m += "\n⚠ スキップ: " + res.skippedDetail.map((d) => `${d.row}行目(${d.reason})`).join(" / ");
                setSheetMsg(m);
              } else setSheetMsg("⚠ " + (res.error || "失敗"));
            } catch { setSheetMsg("⚠ 通信エラー"); }
          }}
          style={{ ...btn("#10B981"), whiteSpace: "nowrap" }}
        >取り込む</button>
      </div>
      {sheetMsg && <p style={{ fontSize: 12, fontWeight: 700, whiteSpace: "pre-wrap", color: sheetMsg.startsWith("✅") ? "#059669" : "#B0483C" }}>{sheetMsg}</p>}

      {/* ③ 手動登録 */}
      <h2 style={h2}>📅 セール日程を1件だけ手動登録</h2>
      <p style={note}>公式発表が出たセールを登録すると、ホームの「開催中・これからのセール」に「確定」として出ます。</p>
      <div style={{ display: "grid", gap: 8 }}>
        <input value={saleForm.name} onChange={(e) => setSaleForm({ ...saleForm, name: e.target.value })} placeholder="セール名(例: 楽天スーパーSALE)" style={inp} />
        <select value={saleForm.store} onChange={(e) => setSaleForm({ ...saleForm, store: e.target.value })} style={inp}>
          <option value="rakuten">楽天</option><option value="yahoo">Yahoo!</option><option value="amazon">Amazon</option>
        </select>
        <label style={{ fontSize: 11, color: "#64748B" }}>開始日<input type="date" value={saleForm.start_date} onChange={(e) => setSaleForm({ ...saleForm, start_date: e.target.value })} style={inp} /></label>
        <label style={{ fontSize: 11, color: "#64748B" }}>終了日(任意)<input type="date" value={saleForm.end_date} onChange={(e) => setSaleForm({ ...saleForm, end_date: e.target.value })} style={inp} /></label>
        <input value={saleForm.url} onChange={(e) => setSaleForm({ ...saleForm, url: e.target.value })} placeholder="会場URL(任意)" style={inp} />
        <button
          onClick={async () => {
            setSaleMsg("送信中…");
            try {
              const res = await fetch("/api/admin/sale-event", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...saleForm, key }) }).then((r) => r.json());
              if (res.ok) { setSaleMsg("✅ 登録しました"); setSaleForm({ name: "", store: "rakuten", start_date: "", end_date: "", url: "" }); }
              else setSaleMsg("⚠ " + (res.error || "登録に失敗しました"));
            } catch { setSaleMsg("⚠ 通信エラー"); }
          }}
          style={btn("#10B981")}
        >セール日程を登録</button>
        {saleMsg && <p style={{ fontSize: 12, fontWeight: 700, color: saleMsg.startsWith("✅") ? "#059669" : "#B0483C" }}>{saleMsg}</p>}
      </div>
    </div>
  );
}

const h2 = { fontSize: 15, fontWeight: 800, margin: "28px 0 6px" };
const note = { fontSize: 11.5, color: "#64748B", lineHeight: 1.7 };
const th = { textAlign: "left", padding: "6px 8px", whiteSpace: "nowrap" };
const td = { padding: "6px 8px", whiteSpace: "nowrap" };
const inp = { border: "1px solid #CBD5E1", borderRadius: 8, padding: "9px 12px", fontSize: 16, outline: "none", width: "100%", boxSizing: "border-box" };
const wrap = { maxWidth: 760, margin: "0 auto", padding: "28px 16px", fontFamily: "'Hiragino Sans','Noto Sans JP',sans-serif", color: "#16324F" };
const btn = (bg) => ({ background: bg, color: "#fff", border: "none", borderRadius: 10, padding: "11px 20px", fontSize: 14, fontWeight: 800, cursor: "pointer" });
