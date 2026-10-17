// ============================================================
// セールカレンダー(v20)
//
//  2024〜2026年の実際の開催日を調べて、周期をルールにしたもの。
//  ・confirmed … 公式発表・実績で日時が分かっているもの(下の CONFIRMED)
//  ・pattern   … 毎年ほぼ同じ日時で開催されているもの(楽天スーパーSALE=4日20時〜11日1:59 など)
//  ・predicted … 例年の傾向からの予想(日付は目安)
//  スプレッドシートから取り込んだ確定情報(sale_events)があれば、そちらを優先する。
//
//  調べた元(2026/10/17時点):
//   楽天スーパーSALE 2024〜2026:3・6・9・12月の4日20:00〜11日01:59
//   楽天お買い物マラソン 2025〜2026:月1〜3回(下の MARATHON)。20:00開始・01:59終了(中旬・下旬の回は09:59終了が多い)
//   楽天ブラックフライデー 2025:11/20 20:00〜11/27 01:59
//   楽天 5と0のつく日:楽天カード決済+エントリーで+1倍(公式)
//   Yahoo! 5のつく日:5・15・25日、PayPay系の支払い+エントリーで+4%(上限2,000円相当・公式)
//   超PayPay祭:2025年7/1〜7/27、2026年3/3〜3/22(公式プレスリリース)
//   Amazon:2026年 初売り1/3〜1/7、新生活セール3/3〜3/9・Final3/31〜4/6、プライムデー7/7〜7/13、
//          プライム感謝祭10/13〜10/19(2025年は10/4〜10/10)、ブラックフライデー2025年11/21〜12/1
// ============================================================

export const SALE_URLS = {
  supersale: "https://event.rakuten.co.jp/campaign/supersale/",
  marathon: "https://event.rakuten.co.jp/campaign/marathon/",
  rakuten_bf: "https://event.rakuten.co.jp/campaign/blackfriday/",
  rakuten_5_0: "https://event.rakuten.co.jp/card/pointday/",
  rakuten_18: "https://event.rakuten.co.jp/campaign/rank/",
  rakuten_1: "https://event.rakuten.co.jp/campaign/wonderfulday/",
  yahoo_5: "https://shopping.yahoo.co.jp/promotion/campaign/5day/",
  paypay_matsuri: "https://shopping.yahoo.co.jp/promotion/campaign/paypaymatsuri/",
  amazon: "https://www.amazon.co.jp/events/",
};

// JSTの日時を作る(月は1始まり)
const jst = (y, m, d, h = 0, mi = 0) => new Date(Date.UTC(y, m - 1, d, h - 9, mi));
const jstParts = (date) => {
  const j = new Date(date.getTime() + 9 * 3600 * 1000);
  return { y: j.getUTCFullYear(), m: j.getUTCMonth() + 1, d: j.getUTCDate(), dow: j.getUTCDay(), h: j.getUTCHours() };
};

// ---------------- 公式・実績で日時が分かっているもの ----------------
export const CONFIRMED = [
  { store: "amazon", key: "prime_kanshasai", name: "Amazonプライム感謝祭 先行セール", start: "2026-10-13T00:00+09:00", end: "2026-10-15T23:59+09:00" },
  { store: "amazon", key: "prime_kanshasai", name: "Amazonプライム感謝祭", start: "2026-10-16T00:00+09:00", end: "2026-10-19T23:59+09:00" },
];

// ---------------- 楽天お買い物マラソン(2025〜2026年の実績から) ----------------
// [開始日, 終了日, 終了時刻] 開始は20:00
const MARATHON = {
  1: [[9, 16, 1], [24, 29, 1]],
  2: [[4, 10, 1], [19, 23, 1]],
  3: [[20, 26, 1]],
  4: [[4, 10, 1], [14, 17, 9], [24, 27, 9]],
  5: [[9, 16, 1], [23, 27, 1]],
  6: [[20, 26, 1]],
  7: [[4, 11, 1], [19, 26, 1]],
  8: [[4, 11, 1], [24, 27, 9]],
  9: [[19, 24, 1]],
  10: [[4, 9, 1], [14, 17, 9], [24, 27, 9]],
  11: [[4, 11, 1]],
  12: [],
};

// その年・月の大型セール(予想を含む)を作る
function bigSalesFor(y, m) {
  const out = [];
  const add = (o) => out.push(o);
  // 楽天スーパーSALE:3・6・9・12月の4日20:00〜11日01:59(2024〜2026年は毎回この日時)
  if ([3, 6, 9, 12].includes(m)) {
    add({ store: "rakuten", key: "supersale", name: "楽天スーパーSALE", start: jst(y, m, 4, 20), end: jst(y, m, 11, 1, 59), confidence: "pattern", url: SALE_URLS.supersale, shopBonus: true, note: "買い回り(1店舗ごとに+1倍・最大10倍)/半額商品" });
  }
  // 楽天お買い物マラソン
  for (const [s, e, eh] of MARATHON[m] || []) {
    add({ store: "rakuten", key: "marathon", name: "楽天お買い物マラソン", start: jst(y, m, s, 20), end: jst(y, m, e, eh, 59), confidence: "predicted", url: SALE_URLS.marathon, shopBonus: true, note: "買い回り(1店舗ごとに+1倍・最大10倍)。日程は例年の傾向" });
  }
  // 楽天ブラックフライデー:11月20日ごろ〜27日(2025年は11/20 20:00〜11/27 01:59)
  if (m === 11) add({ store: "rakuten", key: "rakuten_bf", name: "楽天ブラックフライデー", start: jst(y, 11, 20, 20), end: jst(y, 11, 27, 1, 59), confidence: "predicted", url: SALE_URLS.rakuten_bf, shopBonus: true, note: "買い回りあり。日程は2025年の実績からの目安" });
  // 超PayPay祭:3月・7月(2026年3/3〜3/22、2025年7/1〜7/27)
  if (m === 3) add({ store: "yahoo", key: "paypay_matsuri", name: "超PayPay祭", start: jst(y, 3, 3, 12), end: jst(y, 3, 23, 1, 59), confidence: "predicted", url: SALE_URLS.paypay_matsuri, note: "合計5,000円以上で+4%・2万円以上で+7%(2026年3月の内容)。日程は目安" });
  if (m === 7) add({ store: "yahoo", key: "paypay_matsuri", name: "超PayPay祭", start: jst(y, 7, 1, 12), end: jst(y, 7, 27, 23, 59), confidence: "predicted", url: SALE_URLS.paypay_matsuri, note: "日程は2025年7月の実績からの目安" });
  // Amazon
  if (m === 1) add({ store: "amazon", key: "hatsuuri", name: "Amazon初売り", start: jst(y, 1, 3, 9), end: jst(y, 1, 7, 23, 59), confidence: "predicted", url: SALE_URLS.amazon, note: "2026年は1/3 9:00〜1/7 23:59" });
  if (m === 3) {
    add({ store: "amazon", key: "shinseikatsu", name: "Amazon新生活セール", start: jst(y, 3, 3, 9), end: jst(y, 3, 9, 23, 59), confidence: "predicted", url: SALE_URLS.amazon, note: "2026年は先行3/3〜・本番3/6〜3/9" });
    add({ store: "amazon", key: "shinseikatsu_final", name: "Amazon新生活セールFINAL", start: jst(y, 3, 31, 9), end: jst(y, 4, 6, 23, 59), confidence: "predicted", url: SALE_URLS.amazon, note: "2026年は3/31〜4/6" });
  }
  if (m === 7) add({ store: "amazon", key: "primeday", name: "Amazonプライムデー", start: jst(y, 7, 7, 0), end: jst(y, 7, 13, 23, 59), confidence: "predicted", url: SALE_URLS.amazon, primeOnly: true, note: "プライム会員限定。2026年は先行7/7〜・本番7/10〜7/13" });
  if (m === 10) add({ store: "amazon", key: "prime_kanshasai", name: "Amazonプライム感謝祭", start: jst(y, 10, 4, 0), end: jst(y, 10, 19, 23, 59), confidence: "predicted", url: SALE_URLS.amazon, primeOnly: true, approx: "10月上旬〜中旬", note: "2025年は10/4〜10/10、2026年は10/13〜10/19" });
  if (m === 11) add({ store: "amazon", key: "amazon_bf", name: "Amazonブラックフライデー", start: jst(y, 11, 21, 0), end: jst(y, 12, 1, 23, 59), confidence: "predicted", url: SALE_URLS.amazon, note: "2025年は先行11/21〜・本番11/24〜12/1" });
  return out;
}

// 毎月・毎週の定期イベント(その日だけ)
export function dailyEvents(date = new Date()) {
  const { y, m, d } = jstParts(date);
  const start = jst(y, m, d, 0), end = jst(y, m, d, 23, 59);
  const ev = [];
  const push = (o) => ev.push({ start, end, confidence: "pattern", kind: "daily", ...o });
  if (d % 5 === 0) {
    push({ store: "rakuten", key: "rakuten_5_0", name: "5と0のつく日", url: SALE_URLS.rakuten_5_0, entry: true, needs: "rakuten_card", bonus: 1, note: "楽天カード決済で+1倍(エントリー必要・月1,000ptまで)" });
  }
  if (d === 5 || d === 15 || d === 25) {
    push({ store: "yahoo", key: "yahoo_5", name: "5のつく日", url: SALE_URLS.yahoo_5, entry: true, needs: "paypay", bonus: 4, note: "PayPay残高・PayPayカード等で払うと+4%(エントリー必要・2,000円相当まで)" });
  }
  if (d === 18) {
    push({ store: "rakuten", key: "rakuten_18", name: "ご愛顧感謝デー", url: SALE_URLS.rakuten_18, entry: true, needs: "rank_gold", note: "ゴールド会員以上はランクに応じてポイントアップ(エントリー必要)" });
  }
  if (d === 1) {
    push({ store: "rakuten", key: "rakuten_1", name: "ワンダフルデー", url: SALE_URLS.rakuten_1, entry: true, note: "合計3,000円以上でポイントアップ(エントリー必要)。開催の有無は公式で確認" });
  }
  if (d === 11 || d === 22) {
    push({ store: "yahoo", key: "yahoo_kansha", name: "ヤフショ感謝デー", entry: true, needs: "yahoo_rank", note: "ヤフショランク(シルバー以上)向けのポイントアップ。大型セールと重なる日は開催なし" });
  }
  return ev;
}

// スプレッドシート(sale_events)の行を同じ形に
function fromSheet(ev) {
  const s = ev.start_date ? new Date(`${String(ev.start_date).slice(0, 10)}T00:00:00+09:00`) : null;
  const e = ev.end_date ? new Date(`${String(ev.end_date).slice(0, 10)}T23:59:00+09:00`) : null;
  return { store: ev.store, name: ev.name, start: s, end: e, confidence: "confirmed", url: ev.url || null, note: ev.summary || "", period_text: ev.period_text || "", fromSheet: true };
}

const KEYWORDS = [
  ["supersale", /スーパー\s*SALE|スーパーセール/i],
  ["marathon", /マラソン/],
  ["rakuten_bf", /ブラック/],
  ["amazon_bf", /ブラック/],
  ["paypay_matsuri", /PayPay祭|ペイペイ祭/i],
  ["prime_kanshasai", /感謝祭/],
  ["primeday", /プライムデー/],
  ["hatsuuri", /初売り/],
  ["shinseikatsu", /新生活/],
  ["shinseikatsu_final", /新生活/],
];
const overlap = (a, b) => a.start && b.start && (a.start <= (b.end || b.start)) && (b.start <= (a.end || a.start));

// これからのセール(開催中+先 days 日)を開始が早い順に
export function upcomingSales(now = new Date(), sheetEvents = [], days = 60) {
  const until = new Date(now.getTime() + days * 86400000);
  const { y, m } = jstParts(now);
  const list = [];
  // 前月〜3か月先の大型セール
  for (let i = -1; i <= 3; i++) {
    const mm = ((m - 1 + i + 12) % 12) + 1;
    const yy = y + Math.floor((m - 1 + i) / 12);
    list.push(...bigSalesFor(yy, mm));
  }
  // 公式発表済みの日時は予想を置き換える
  const confirmed = CONFIRMED.map((c) => ({ ...c, start: new Date(c.start), end: new Date(c.end), confidence: "confirmed", url: SALE_URLS.amazon }));
  let merged = list.filter((p) => !confirmed.some((c) => c.key === p.key && c.store === p.store && Math.abs(c.start - p.start) < 45 * 86400000));
  merged.push(...confirmed);
  // スプレッドシートの確定情報があれば、同じセールの予想は消す
  const sheet = (sheetEvents || []).map(fromSheet).filter((e) => e.start && e.store);
  merged = merged.filter((p) => {
    const re = (KEYWORDS.find(([k]) => k === p.key) || [])[1];
    return !sheet.some((s) => s.store === p.store && (!re || re.test(s.name)) && overlap(p, s));
  });
  merged.push(...sheet);
  return merged
    .filter((e) => e.start && (e.end || e.start) >= now && e.start <= until)
    .map((e) => ({ ...e, live: e.start <= now && now <= (e.end || e.start) }))
    .sort((a, b) => (b.live - a.live) || (a.start - b.start));
}

// 「10/24(土) 20:00〜10/27(火) 9:59」
const DOW = "日月火水木金土";
export function fmtRange(e) {
  if (e.approx && e.confidence === "predicted") return `${e.approx}(予想)`;
  const f = (dt) => {
    const p = jstParts(dt);
    const j = new Date(dt.getTime() + 9 * 3600 * 1000);
    const hm = `${j.getUTCHours()}:${String(j.getUTCMinutes()).padStart(2, "0")}`;
    return `${p.m}/${p.d}(${DOW[p.dow]})${hm === "0:00" ? "" : " " + hm}`;
  };
  if (!e.start) return e.period_text || "";
  if (!e.end) return `${f(e.start)}〜`;
  return `${f(e.start)}〜${f(e.end)}`;
}

export const CONFIDENCE_LABEL = {
  confirmed: { text: "確定", color: "#065F46", bg: "#D1FAE5" },
  pattern: { text: "毎年同じ日程", color: "#1D4ED8", bg: "#DBEAFE" },
  predicted: { text: "予想", color: "#92400E", bg: "#FEF3C7" },
};

// あと何日(0=今日)
export function daysUntil(dt, now = new Date()) {
  const a = jstParts(now), b = jstParts(dt);
  const da = Date.UTC(a.y, a.m - 1, a.d), db = Date.UTC(b.y, b.m - 1, b.d);
  return Math.round((db - da) / 86400000);
}
