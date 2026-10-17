// ============================================================
// 価格履歴から「指値の到達しやすさ」を計算する(v12)
// 株の板情報のように「この値段は過去どれくらいの頻度で出たか」を示す。
// ============================================================

// rows: [{price, recorded_at, slot}] (price_historyの取得結果)
// target: 希望価格
// 戻り値: { days, hitDays, pct, label, tone, lastHit }
export function targetReachability(rows, target) {
  if (!rows || rows.length === 0 || !(target > 0)) return null;
  // 1日ごとにその日の最安値をとる(半日枠が2件ある日は安い方)
  const byDay = new Map();
  for (const r of rows) {
    const d = r.recorded_at;
    if (!byDay.has(d) || r.price < byDay.get(d)) byDay.set(d, r.price);
  }
  const days = [...byDay.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  if (days.length < 3) return null; // 判定するには記録が少なすぎる
  const hits = days.filter(([, p]) => p <= target);
  const pct = Math.round((hits.length / days.length) * 100);
  const lastHit = hits.length ? hits[hits.length - 1][0] : null;
  let label, tone;
  if (pct === 0) {
    label = "記録した期間では一度もこの価格になっていません";
    tone = "rare";
  } else if (pct < 10) {
    label = `まれにこの価格になります(記録の${pct}%の日)`;
    tone = "rare";
  } else if (pct < 35) {
    label = `時々この価格になります(記録の${pct}%の日)`;
    tone = "sometimes";
  } else if (pct < 70) {
    label = `よくこの価格になります(記録の${pct}%の日)`;
    tone = "often";
  } else {
    label = `ほぼいつもこの価格以下です(記録の${pct}%の日)`;
    tone = "always";
  }
  return { days: days.length, hitDays: hits.length, pct, label, tone, lastHit };
}

// 記録から「狙い目の価格」を提案する(下位25%の価格帯)
export function suggestTarget(rows) {
  if (!rows || rows.length < 3) return null;
  const byDay = new Map();
  for (const r of rows) {
    const d = r.recorded_at;
    if (!byDay.has(d) || r.price < byDay.get(d)) byDay.set(d, r.price);
  }
  const prices = [...byDay.values()].sort((a, b) => a - b);
  if (prices.length < 3) return null;
  return prices[Math.floor(prices.length * 0.25)];
}
