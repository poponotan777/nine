import { amazonUrl } from "./featureFlags";
// ============================================================
// セールカレンダー
// - 定期セール: 日付計算だけで完全自動(5と0のつく日など)
// - 大型セール: 例年の開催時期から「まもなく」を予測表示。
//   Supabaseのsale_eventsに確定日程を入れると「開催決定」表示に昇格
// ============================================================

// 今日開催中の定期セール
export function todayDeals(date = new Date()) {
  const d = date.getDate();
  const day = date.getDay(); // 0=日曜
  const deals = [];
  if (d % 5 === 0) {
    deals.push({ store: "rakuten", label: "5と0のつく日(楽天カードでポイントアップ)" });
    deals.push({ store: "yahoo", label: "5のつく日(PayPayポイント+4%)" });
  }
  if (d === 1) deals.push({ store: "rakuten", label: "ワンダフルデー(1日限定ポイントアップ)" });
  if (d === 18) deals.push({ store: "rakuten", label: "いちばの日(市場の日)" });
  if (day === 0) deals.push({ store: "yahoo", label: "日曜日(LYPプレミアム会員 +α)" });
  return deals;
}

// 次の「5と0のつく日」まであと何日か
export function nextFiveZeroDay(date = new Date()) {
  for (let i = 1; i <= 5; i++) {
    const t = new Date(date);
    t.setDate(date.getDate() + i);
    if (t.getDate() % 5 === 0) return { date: t, daysLeft: i };
  }
  return null;
}

// 大型セールの公式ページURL(名前の部分一致で自動リンク)
const SALE_URLS = [
  ["プライムデー", amazonUrl("https://www.amazon.co.jp/primeday")],
  ["ブラックフライデー", amazonUrl("https://www.amazon.co.jp/blackfriday")],
  ["初売り", amazonUrl("https://www.amazon.co.jp/newyearsale")],
  ["スーパーセール", "https://event.rakuten.co.jp/campaign/supersale/"],
  ["マラソン", "https://event.rakuten.co.jp/campaign/marathon/"],
  ["PayPay", "https://toku.yahoo.co.jp/"],
];
export function saleUrlFor(name) {
  const hit = SALE_URLS.find(([k]) => name && name.includes(k));
  return hit ? hit[1] : null;
}

// 大型セールの例年スケジュール(月と時期の目安)
const BIG_SALES = [
  { key: "primeday", store: "amazon", name: "Amazonプライムデー", months: [7], period: "中旬", leadDays: 21 },
  { key: "blackfriday", store: "amazon", name: "Amazonブラックフライデー", months: [11], period: "下旬", leadDays: 21 },
  { key: "amazon-hatsuuri", store: "amazon", name: "Amazon初売り", months: [1], period: "上旬", leadDays: 14 },
  { key: "supersale", store: "rakuten", name: "楽天スーパーセール", months: [3, 6, 9, 12], period: "上旬〜中旬", leadDays: 14 },
  { key: "marathon", store: "rakuten", name: "楽天お買い物マラソン", months: [1,2,3,4,5,6,7,8,9,10,11,12], period: "月内(ほぼ毎月)", leadDays: 0, lowKey: true },
  { key: "paypay-matsuri", store: "yahoo", name: "超PayPay祭", months: [3, 7, 11], period: "月内", leadDays: 14 },
];

// 「まもなく開催」の予測リストを返す。
// confirmed: sale_eventsテーブルの行 [{name, store, start_date, end_date}]
export function upcomingBigSales(date = new Date(), confirmed = []) {
  const results = [];
  const today = date.toISOString().slice(0, 10);

  // 確定情報(開催中 or 7日以内に開始)を最優先
  for (const ev of confirmed) {
    if (!ev.start_date) continue;
    const start = new Date(ev.start_date);
    const end = ev.end_date ? new Date(ev.end_date) : start;
    const daysToStart = Math.ceil((start - date) / 86400000);
    if (today >= ev.start_date && today <= (ev.end_date || ev.start_date)) {
      results.push({ ...ev, status: "live", label: `${ev.name} 開催中!(〜${fmt(end)})`, url: ev.url || saleUrlFor(ev.name) });
    } else if (daysToStart > 0 && daysToStart <= 14) {
      results.push({ ...ev, status: "confirmed", label: `${ev.name} ${fmt(start)}から開催決定`, url: ev.url || saleUrlFor(ev.name) });
    }
  }

  // 確定が無いものは例年予測
  const confirmedNames = new Set(confirmed.map((e) => e.name));
  const month = date.getMonth() + 1;
  const nextMonth = (month % 12) + 1;
  for (const s of BIG_SALES) {
    if (s.lowKey) continue;
    if (confirmedNames.has(s.name)) continue;
    if (s.months.includes(month)) {
      results.push({ name: s.name, store: s.store, status: "predicted", label: `🔔 まもなく${s.name}(例年${month}月${s.period}に開催)`, url: saleUrlFor(s.name) });
    } else if (s.months.includes(nextMonth) && date.getDate() >= 20) {
      results.push({ name: s.name, store: s.store, status: "predicted", label: `🔔 ${s.name}が近づいています(例年${nextMonth}月${s.period})`, url: saleUrlFor(s.name) });
    }
  }
  return results;
}

function fmt(d) {
  return `${d.getMonth() + 1}/${d.getDate()}`;
}
