// 価格記録のヘルパー
// v10で「1日2回(正午境目)」にしたが、price_historyの行数が増えすぎて
// Supabaseの負荷・容量を圧迫したため、v14で【1日1回】に戻した。
//
// ・slotは常に0を使う(列とインデックスはそのまま。将来2回に戻せる)
// ・record_price_min により、同じ日に何度記録が来ても
//   「その日の最安値」が残る(旧来の"最初の1件だけ残す"より正確)
// ・recorded_hourには最安を観測した時刻を入れる
// サーバー(Vercel)はUTCで動くため、必ずJSTに変換してから日付・時刻を出すこと。

// 1日あたりの記録枠。1=1日1回 / 2=正午を境に1日2回
export const SLOTS_PER_DAY = 1;

export function jstNowParts() {
  const jst = new Date(Date.now() + 9 * 3600 * 1000); // UTC+9
  const recorded_at = jst.toISOString().slice(0, 10); // JSTの日付
  const hour = jst.getUTCHours(); // JSTの「時」(0-23)
  const slot = SLOTS_PER_DAY === 2 ? (hour < 12 ? 0 : 1) : 0;
  return { recorded_at, slot, hour };
}

// rows: [{jan, store, price}] を現在のJST半日枠で書き込む。
// v10のrecord_price_min(同枠内は最安値を保持)を優先し、
// 関数が未作成(SQL未実行)の環境では旧来のupsertにフォールバックして
// アプリを止めない(その場合は枠内最安ではなく最初の値が残る)。
export async function writePriceRows(admin, rows) {
  if (!rows || rows.length === 0) return 0;
  const { recorded_at, slot, hour } = jstNowParts();
  const payload = rows.map((r) => ({
    jan: r.jan, store: r.store, price: String(Math.round(Number(r.price))),
    recorded_at, slot, hour,
  }));
  try {
    const { data, error } = await admin.rpc("record_price_min", { _rows: payload });
    if (!error) return typeof data === "number" ? data : payload.length;
  } catch {}
  // フォールバック(supabase-v10.sql 実行前でも動くように)
  try {
    const legacy = rows.map((r) => ({
      jan: r.jan, store: r.store, price: Math.round(Number(r.price)), recorded_at,
    }));
    const { error } = await admin
      .from("price_history")
      .upsert(legacy, { onConflict: "jan,store,recorded_at", ignoreDuplicates: true });
    return error ? 0 : legacy.length;
  } catch {
    return 0;
  }
}
