"use client";
// ============================================================
// セールカレンダーと「あなたのステータス」(v20)
//   TodayStrip       … ホーム上部:今日の各サイトの還元率(目安)と、今日のイベント
//   SaleCalendarList … 開催中・これからのセール(確定/毎年同じ日程/予想 を区別)
//   StatusForm       … マイページ:かんたんな記入(端末内だけに保存)
// ============================================================

import { useState } from "react";
import { upcomingSales, fmtRange, CONFIDENCE_LABEL, daysUntil } from "../../lib/saleCalendar";
import { todayRates, RAKUTEN_RANKS, YAHOO_RANKS } from "../../lib/status";
import { STORE_META } from "../../lib/priceView";

const Badge = ({ store }) => (
  <span style={{ fontSize: 9.5, fontWeight: 800, color: "#fff", background: STORE_META[store]?.color || "#64748B", borderRadius: 4, padding: "2px 7px", whiteSpace: "nowrap" }}>
    {STORE_META[store]?.short || store}
  </span>
);

export function TodayStrip({ status, baseRates, sheetEvents, onEdit }) {
  const t = todayRates(status, baseRates, new Date(), sheetEvents);
  return (
    <div style={{ background: "#fff", border: "1px solid #DDE9E4", borderRadius: 14, padding: 14, marginBottom: 14 }}>
      <div style={{ display: "flex", alignItems: "center", marginBottom: 8 }}>
        <h2 style={{ fontSize: 14, fontWeight: 800, margin: 0 }}>💰 今日のあなたの還元率(目安)</h2>
        <button onClick={onEdit} style={{ marginLeft: "auto", fontSize: 11.5, fontWeight: 700, color: "#2563EB", background: "none", border: "none", cursor: "pointer" }}>
          {status?.set ? "ステータスを変更" : "ステータスを設定 ›"}
        </button>
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 6 }}>
        {["rakuten", "yahoo", "amazon"].map((s) => (
          <div key={s} style={{ border: `1.5px solid ${STORE_META[s].color}22`, borderRadius: 10, padding: "8px 8px", background: "#FBFDFC", minWidth: 0 }}>
            <div style={{ fontSize: 11, fontWeight: 800, color: STORE_META[s].color }}>{STORE_META[s].short}</div>
            <div style={{ fontSize: 19, fontWeight: 900, color: "#16324F", lineHeight: 1.2 }}>
              {Math.round(t[s].pct * 10) / 10}<span style={{ fontSize: 11 }}>{s === "rakuten" && status?.set ? "倍" : "%"}</span>
            </div>
            {t[s].lines.slice(1).map((l, i) => (
              <div key={i} style={{ fontSize: 9.5, color: "#475569", lineHeight: 1.45, marginTop: 2 }}>{l}</div>
            ))}
            {t[s].events.filter((e) => e.url).slice(0, 1).map((e) => (
              <a key={e.name} href={e.url} target="_blank" rel="noopener noreferrer" style={{ display: "inline-block", fontSize: 9.5, fontWeight: 800, color: "#2563EB", marginTop: 3, textDecoration: "none" }}>
                {e.entry ? "エントリー ›" : "会場 ›"}
              </a>
            ))}
          </div>
        ))}
      </div>
      {!status?.set && (
        <p style={{ fontSize: 10.5, color: "#64748B", margin: "8px 0 0", lineHeight: 1.6 }}>
          楽天カードの有無・SPU倍率・PayPay払いなどを設定すると、「5と0のつく日」「5のつく日」「買い回り」を自動で足して実質価格を出します(この端末にだけ保存)。
        </p>
      )}
    </div>
  );
}

export function SaleCalendarList({ sheetEvents, loaded, max = 6 }) {
  const [all, setAll] = useState(false);
  if (!loaded) return null;
  const now = new Date();
  const list = upcomingSales(now, sheetEvents, 75);
  if (list.length === 0) return null;
  const shown = all ? list : list.slice(0, max);
  return (
    <div style={{ marginBottom: 16 }}>
      <h2 style={{ fontSize: 14, fontWeight: 800, margin: "0 0 8px" }}>🗓 開催中・これからのセール</h2>
      {shown.map((e, i) => {
        const endIn = e.end ? daysUntil(e.end, now) : null;
        const startIn = daysUntil(e.start, now);
        const tier = e.live ? (endIn === 0 ? "today" : endIn === 1 ? "tomorrow" : "live") : "soon";
        const th = {
          today: { bg: "#FEE2E2", border: "2.5px solid #DC2626", tag: "⏰ 本日終了", tagBg: "#DC2626", name: "#991B1B", shadow: "0 0 0 3px rgba(220,38,38,0.14), 0 6px 16px rgba(220,38,38,0.25)" },
          tomorrow: { bg: "#FFF7ED", border: "2px solid #EA580C", tag: "⏳ 明日終了", tagBg: "#EA580C", name: "#9A3412", shadow: "0 2px 8px rgba(234,88,12,0.18)" },
          live: { bg: "#FEF6F6", border: "1px solid #F0B4B4", tag: "開催中", tagBg: "#CE6B6B", name: "#9B4B4B", shadow: "none" },
          soon: { bg: "#EFF6FF", border: "1.5px solid #93C5FD", tag: startIn <= 0 ? "まもなく" : `あと${startIn}日`, tagBg: "#2563EB", name: "#1E3A8A", shadow: "none" },
        }[tier];
        const conf = CONFIDENCE_LABEL[e.confidence] || CONFIDENCE_LABEL.predicted;
        const body = (
          <>
            <div style={{ display: "flex", alignItems: "center", gap: 5, marginBottom: 4, flexWrap: "wrap" }}>
              <Badge store={e.store} />
              <span style={{ fontSize: 9.5, fontWeight: 800, color: "#fff", background: th.tagBg, borderRadius: 4, padding: "2px 7px" }}>{th.tag}</span>
              <span style={{ fontSize: 9.5, fontWeight: 800, color: conf.color, background: conf.bg, borderRadius: 4, padding: "2px 7px" }}>{conf.text}</span>
              {e.primeOnly && <span style={{ fontSize: 9.5, fontWeight: 800, color: "#0369A1", background: "#E0F2FE", borderRadius: 4, padding: "2px 7px" }}>プライム会員</span>}
              {e.url && <span style={{ marginLeft: "auto", fontSize: 11, fontWeight: 700, color: "#64748B" }}>会場 ↗</span>}
            </div>
            <div style={{ fontSize: tier === "today" ? 15 : 13, fontWeight: 800, color: th.name, lineHeight: 1.4 }}>{e.name}</div>
            <div style={{ fontSize: 11, color: "#475569" }}>🗓 {e.fromSheet && e.period_text ? e.period_text : fmtRange(e)}</div>
            {e.note && <div style={{ fontSize: 10.5, color: "#64748B", lineHeight: 1.5, marginTop: 2 }}>{e.note}</div>}
          </>
        );
        const style = { display: "block", textDecoration: "none", background: th.bg, border: th.border, borderRadius: 12, padding: "10px 13px", marginBottom: 8, boxShadow: th.shadow };
        return e.url
          ? <a key={i} href={e.url} target="_blank" rel="noopener noreferrer sponsored" style={style}>{body}</a>
          : <div key={i} style={style}>{body}</div>;
      })}
      {list.length > max && (
        <button onClick={() => setAll((v) => !v)} style={{ width: "100%", background: "#fff", border: "1px solid #CBD5E1", borderRadius: 10, padding: "9px 0", fontSize: 12, fontWeight: 700, color: "#16324F", cursor: "pointer" }}>
          {all ? "閉じる" : `ほかに${list.length - max}件のセールを見る`}
        </button>
      )}
      <p style={{ fontSize: 10, color: "#94A3B8", margin: "6px 0 0", lineHeight: 1.6 }}>
        「確定」は公式発表やシート登録済み、「毎年同じ日程」は過去の開催日時が毎年同じもの、「予想」は例年の傾向からの目安です。正式な日程は各サイトでご確認ください。
      </p>
    </div>
  );
}

const field = { border: "1px solid #CBD5E1", borderRadius: 8, padding: "8px 10px", fontSize: 16, background: "#fff" };
const row = { display: "flex", alignItems: "center", gap: 8, marginBottom: 8, flexWrap: "wrap" };
const lab = { fontSize: 12.5, fontWeight: 700, color: "#334155", minWidth: 120 };
const chk = { display: "flex", alignItems: "center", gap: 8, marginBottom: 8 };

export function StatusForm({ status, onSave }) {
  const [s, setS] = useState(status);
  const [msg, setMsg] = useState("");
  const set = (store, k, v) => setS((p) => ({ ...p, [store]: { ...p[store], [k]: v } }));
  const save = () => { onSave(s); setMsg("保存しました"); setTimeout(() => setMsg(""), 2500); };
  return (
    <div>
      <h2 style={{ fontSize: 15, fontWeight: 800, marginTop: 0 }}>あなたのステータス(かんたん記入)</h2>
      <p style={{ fontSize: 12, color: "#475569", lineHeight: 1.7, marginTop: 0 }}>
        わかる所だけでOK。今日のセール(5と0のつく日・5のつく日・買い回りなど)を自動で足して、
        ホームの「今日のあなたの還元率」と、全商品の実質価格に反映します。この端末にだけ保存され、サーバーには送りません。
      </p>

      <div style={{ fontSize: 13, fontWeight: 800, color: STORE_META.rakuten.color, margin: "12px 0 6px" }}>楽天市場</div>
      <div style={row}>
        <span style={lab}>SPU倍率</span>
        <input type="number" min="1" max="30" step="0.5" value={s.rakuten.spu} onChange={(e) => set("rakuten", "spu", parseFloat(e.target.value) || 1)} style={{ ...field, width: 80 }} />
        <span style={{ fontSize: 11.5, color: "#64748B" }}>倍(楽天市場のトップに出る数字)</span>
      </div>
      <label style={chk}><input type="checkbox" checked={!!s.rakuten.card} onChange={(e) => set("rakuten", "card", e.target.checked)} /> <span style={{ fontSize: 12.5 }}>楽天カードで払う(5と0のつく日 +1倍)</span></label>
      <div style={row}>
        <span style={lab}>会員ランク</span>
        <select value={s.rakuten.rank} onChange={(e) => set("rakuten", "rank", e.target.value)} style={field}>
          {RAKUTEN_RANKS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
        </select>
      </div>
      <div style={row}>
        <span style={lab}>買い回りの予定</span>
        <input type="number" min="1" max="10" step="1" value={s.rakuten.shops} onChange={(e) => set("rakuten", "shops", parseInt(e.target.value, 10) || 1)} style={{ ...field, width: 70 }} />
        <span style={{ fontSize: 11.5, color: "#64748B" }}>店舗(マラソン・スーパーSALE中に使います)</span>
      </div>

      <div style={{ fontSize: 13, fontWeight: 800, color: STORE_META.yahoo.color, margin: "14px 0 6px" }}>Yahoo!ショッピング</div>
      <div style={row}>
        <span style={lab}>ふだんの還元率</span>
        <input type="number" min="0" max="30" step="0.5" value={s.yahoo.base} onChange={(e) => set("yahoo", "base", parseFloat(e.target.value) || 0)} style={{ ...field, width: 80 }} />
        <span style={{ fontSize: 11.5, color: "#64748B" }}>%</span>
      </div>
      <label style={chk}><input type="checkbox" checked={!!s.yahoo.paypay} onChange={(e) => set("yahoo", "paypay", e.target.checked)} /> <span style={{ fontSize: 12.5 }}>PayPay残高・PayPayカードで払う(5のつく日 +4%)</span></label>
      <div style={row}>
        <span style={lab}>ヤフショランク</span>
        <select value={s.yahoo.rank} onChange={(e) => set("yahoo", "rank", e.target.value)} style={field}>
          {YAHOO_RANKS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
        </select>
      </div>

      <div style={{ fontSize: 13, fontWeight: 800, color: STORE_META.amazon.color, margin: "14px 0 6px" }}>Amazon</div>
      <div style={row}>
        <span style={lab}>ふだんの還元率</span>
        <input type="number" min="0" max="30" step="0.5" value={s.amazon.base} onChange={(e) => set("amazon", "base", parseFloat(e.target.value) || 0)} style={{ ...field, width: 80 }} />
        <span style={{ fontSize: 11.5, color: "#64748B" }}>%(カードの還元など)</span>
      </div>
      <label style={chk}><input type="checkbox" checked={!!s.amazon.prime} onChange={(e) => set("amazon", "prime", e.target.checked)} /> <span style={{ fontSize: 12.5 }}>プライム会員</span></label>

      <label style={{ ...chk, marginTop: 10 }}><input type="checkbox" checked={s.applyToPrice !== false} onChange={(e) => setS((p) => ({ ...p, applyToPrice: e.target.checked }))} /> <span style={{ fontSize: 12.5 }}>今日のセール分も実質価格に含める</span></label>

      <button onClick={save} style={{ width: "100%", marginTop: 6, background: "#16324F", color: "#fff", border: "none", borderRadius: 10, padding: "11px 0", fontSize: 13.5, fontWeight: 800, cursor: "pointer" }}>
        保存する
      </button>
      {msg && <p style={{ fontSize: 12, color: "#059669", fontWeight: 700, margin: "6px 0 0" }}>{msg}</p>}
      <p style={{ fontSize: 10.5, color: "#94A3B8", lineHeight: 1.6, marginTop: 8 }}>
        計算は目安です。エントリーの有無・上限・対象外の商品は、各サイトのキャンペーンページでご確認ください。
      </p>
    </div>
  );
}
