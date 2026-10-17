// ============================================================
// オウダン 自動取得(GitHub Actions から 1日2回 呼ばれる)
//   午前5時(am)・午後5時(pm)・補完だけ11時/23時(fill)。3サイトを同時に進める(上限はサイトごとに別なので)
//
//   手元で試すとき:
//     DRY_RUN=1 SLOT=am RUN_MINUTES=2 npx tsx collector/run.js
//   (DRY_RUN=1 ならDBに書き込まない)
// ============================================================

import { appendFileSync } from "node:fs";
import { Clock, log, rpc, rest, dbReady, jstDay, jstHour } from "./core.js";
import { runRakuten } from "./rakuten.js";
import { runYahoo } from "./yahoo.js";
import { runAmazon } from "./amazon.js";

const MB = 1024 * 1024;
const WARN_BYTES = Number(process.env.DB_WARN_MB || 400) * MB;   // これを超えたら「有料プランを検討」の通知
const STOP_BYTES = Number(process.env.DB_STOP_MB || 450) * MB;   // これを超えたら新しい商品を増やさない

function summary(md) {
  const f = process.env.GITHUB_STEP_SUMMARY;
  if (f) { try { appendFileSync(f, md + "\n"); } catch {} }
}

async function main() {
  const dryRun = process.env.DRY_RUN === "1";
  // 時刻で自動:3〜9時=午前(am) / 15〜20時=午後(pm) / それ以外=補完だけの回(fill・v24)
  const h = jstHour();
  const auto = h >= 3 && h <= 9 ? "am" : h >= 15 && h <= 20 ? "pm" : "fill";
  const slot = (process.env.SLOT || "").trim() || auto;
  const minutes = Number(process.env.RUN_MINUTES || (slot === "am" ? 33 : slot === "pm" ? 20 : 25));
  const SLOT_NAME = { am: "午前", pm: "午後", fill: "補完だけ" };
  const day = jstDay();
  const clock = new Clock(minutes);
  log(`=== オウダン自動取得 ${day} ${SLOT_NAME[slot] || slot} (最大${minutes}分)${dryRun ? " [書き込みなし]" : ""} ===`);

  if (!dryRun && !dbReady()) {
    console.log("::error::SUPABASE_URL と SUPABASE_SECRET_KEY が設定されていません(GitHub の Settings → Secrets)");
    process.exit(1);
  }

  // 容量チェック(危なければ新しい商品は増やさず、今ある商品の価格だけ更新)
  let noNew = false;
  if (!dryRun) {
    try {
      const u = await rpc("db_usage", {});
      const bytes = Number(u?.db_bytes || 0);
      log(`DB容量 ${(bytes / MB).toFixed(1)}MB / 商品 ${u?.products} / 価格行 ${u?.offers} / 補完待ち ${u?.queue}`);
      if (bytes > STOP_BYTES) {
        noNew = true;
        log(`容量が ${process.env.DB_STOP_MB || 450}MB を超えているため、新しい商品は追加しません`);
      }
    } catch (e) {
      console.log("::error::DBに接続できません。v18のSQLを実行したか、URLとキーを確認してください: " + String(e).slice(0, 200));
      process.exit(1);
    }
  }

  const ctx = { clock, slot, day, noNew, dryRun };
  const results = await Promise.allSettled([runRakuten(ctx), runYahoo(ctx), runAmazon(ctx)]);
  const stats = results.map((r, i) => (r.status === "fulfilled" ? r.value : { store: ["rakuten", "yahoo", "amazon"][i], note: "失敗: " + String(r.reason).slice(0, 200), requests: 0, written: 0, errors: 1 }));

  if (!dryRun) {
    // 他サイトにまだ無い商品を、次回探す予約に入れる
    try {
      const n = await rpc("enqueue_missing", { _limit: 20000 });
      log(`補完の予約に追加 ${n}件`);
    } catch (e) { log("補完の予約に失敗", String(e).slice(0, 200)); }

    try {
      await rest("collect_runs", {
        method: "POST",
        body: stats.map((s) => ({
          started_at: new Date(clock.start).toISOString(),
          finished_at: new Date().toISOString(),
          slot, store: s.store, requests: s.requests || 0, items: s.written || 0, errors: s.errors || 0,
          note: (s.note || "").slice(0, 300),
        })),
        prefer: "return=minimal",
      });
    } catch (e) { log("実行記録の保存に失敗", String(e).slice(0, 200)); }
  }

  // 結果のまとめ(GitHub の実行画面に表で出る)
  const NAMES = { rakuten: "楽天", yahoo: "Yahoo!", amazon: "Amazon" };
  summary(`## オウダン自動取得 ${day} ${SLOT_NAME[slot] || slot}(${clock.elapsedMin()}分)`);
  summary("| サイト | APIリクエスト | 書き込み | エラー | メモ |\n|---|---:|---:|---:|---|");
  for (const s of stats) summary(`| ${NAMES[s.store]} | ${s.requests || 0} | ${s.written || 0} | ${s.errors || 0} | ${(s.note || "").replace(/\|/g, "/")} |`);

  let exitCode = 0;
  if (!dryRun) {
    try {
      const u = await rpc("db_usage", {});
      const bytes = Number(u?.db_bytes || 0);
      const mb = (bytes / MB).toFixed(1);
      summary(`\n**DB容量:${mb}MB / 500MB**(商品 ${u?.products}件・価格行 ${u?.offers}件・補完待ち ${u?.queue}件)`);
      const tables = Object.entries(u?.tables || {}).sort((a, b) => b[1] - a[1]).slice(0, 6);
      summary(tables.map(([t, b]) => `- ${t}: ${(b / MB).toFixed(1)}MB`).join("\n"));
      log(`DB容量 ${mb}MB`);
      if (bytes > WARN_BYTES) {
        // 失敗扱いにすると、GitHub からメールで知らせが届く
        console.log(`::error::DB容量が ${mb}MB になりました(無料枠500MB)。Supabase の Pro プランへの切り替えを検討してください`);
        summary(`\n### ⚠ DB容量が ${mb}MB です。無料枠(500MB)に近づいています。Supabase Pro への切り替えを検討してください`);
        exitCode = 1;
      }
    } catch {}
  }

  const allFailed = stats.every((s) => (s.written || 0) === 0) && stats.some((s) => (s.requests || 0) > 0);
  if (allFailed && !dryRun) {
    console.log("::error::どのサイトからも商品を書き込めませんでした。キーや設定を確認してください");
    exitCode = 1;
  }
  log(`=== 終了(${clock.elapsedMin()}分) ===`);
  process.exit(exitCode);
}

main().catch((e) => {
  console.log("::error::" + String(e && e.stack ? e.stack : e).slice(0, 500));
  process.exit(1);
});
