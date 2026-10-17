// ============================================================
// DB書き込みの制御(v15)
//
// 背景: SupabaseのディスクI/Oバジェットを使い果たし、
//       あらゆるクエリがタイムアウトする事態になった。
//       原因は「サイトを閲覧するだけで大量に書き込む」設計。
//         ・検索1回 → 最大500商品×モール数 ≒ 1000行の書き込み
//         ・商品を見るたび activity_log に1行
//         ・ホーム表示のたびに値下がり通知の検証
//
// ここで各書き込みのON/OFFと量を一元管理する。
// 無料プラン(ナノ)で運用する間は控えめに、
// 有料プランに移行したら数値を戻す/trueに戻す、という運用を想定。
// ============================================================

// 検索結果の便乗記録。
//  false = 記録しない(クローラーが巡回するので履歴は貯まり続ける)
//  true  = 記録する。RECORD_LIMIT件までに絞る
export const RECORD_ON_SEARCH = false;
// 便乗記録する場合の上限件数(表示順の上位のみ)
export const RECORD_LIMIT = 20;
// 同じ端末で連続して記録しないための最小間隔(ミリ秒)
export const RECORD_MIN_INTERVAL_MS = 30 * 60 * 1000; // 30分

// 行動ログ(将来の協調フィルタリング用)。
// 「数百人分貯まったら使う」将来機能のため、ユーザーが少ない間は止めておく
export const ACTIVITY_LOG_ON = false;

// 値下がり通知のバックグラウンド検証(ホーム表示中にライブ価格と照合)
export const VERIFY_ALERTS_ON = false;

// ピックアップAPIの便乗記録(ホームを開くたびに書き込む)
export const RECORD_ON_PICKUP = false;

// クローラーの分割巡回:
// 592キーワードを一度に回すとI/Oを大量消費するため、曜日ごとに分割する。
// 1 = 分割しない(従来どおり全件) / 7 = 7分割(1日あたり約85語)
export const CRAWL_SPLIT = 7;

// 端末内で「最後に便乗記録した時刻」を見て、間隔が短ければ記録しない
export function canRecordNow() {
  if (!RECORD_ON_SEARCH) return false;
  try {
    const last = parseInt(localStorage.getItem("lastRecordAt") || "0", 10);
    if (Date.now() - last < RECORD_MIN_INTERVAL_MS) return false;
    localStorage.setItem("lastRecordAt", String(Date.now()));
    return true;
  } catch {
    return false;
  }
}
