#!/usr/bin/env node
/**
 * カードと集計を消す。テストで作ったものを片付けるためのもの。
 *
 * 使い方（Renderのシェル、またはDATABASE_URLを渡したローカル）:
 *   node tools/reset-cards.js            … 今どうなっているかを表示するだけ
 *   node tools/reset-cards.js --yes      … 実際に消す
 *   node tools/reset-cards.js --yes --before 2026-09-06
 *                                        … その日より前に作られたカードだけ消す
 *
 * 消すもの:
 *   cards       … カード本体
 *   card_items  … カードの中身（cardsを消せばカスケードで一緒に消える）
 *   item_stats  … ランキングの集計
 *
 * 消さないもの:
 *   kv          … 外部APIの応答キャッシュ。消しても直るが、
 *                 消すと復帰までAPIを叩き直すので残す。
 *
 * item_stats を必ず一緒に消す理由:
 *   この表はカードとは寿命が違い、カードが90日で消えても数字は残り続ける。
 *   cards だけ消すと、ランキングにテストの数字が居座ったままになる。
 *
 * --before を付けた場合は item_stats を全消しせず、
 * 残ったカードから積み直す。部分削除で数字だけ合わなくなるのを避けるため。
 */
'use strict';

const args   = process.argv.slice(2);
const DO_IT  = args.includes('--yes');
const bIdx   = args.indexOf('--before');
const BEFORE = bIdx >= 0 ? args[bIdx + 1] : null;

if (bIdx >= 0 && !/^\d{4}-\d{2}-\d{2}$/.test(BEFORE || '')) {
  console.error('--before は YYYY-MM-DD の形で指定してください。例: --before 2026-09-06');
  process.exit(1);
}

if (!process.env.DATABASE_URL) {
  console.error('DATABASE_URL が設定されていません。');
  console.error('本番を消すつもりなら、Renderのシェルから実行してください。');
  process.exit(1);
}

const { Pool } = require('pg');
// Renderの外部DBはSSLが要る。ローカルやUNIXソケット接続では逆に繋がらないので、
// 接続文字列を見て切り替える。
const URL = process.env.DATABASE_URL;
const needSSL = /^postgres(ql)?:\/\//.test(URL)
             && !/localhost|127\.0\.0\.1|host=\//.test(URL)
             && !/sslmode=disable/.test(URL);
const pool = new Pool({
  connectionString: URL,
  ssl: needSSL ? { rejectUnauthorized: false } : false,
  max: 2,
});

const q = (sql, p) => pool.query(sql, p);
const n = async (sql, p) => Number((await q(sql, p)).rows[0].c);

(async () => {
  // ---- いまの状態 ----
  const before = {
    cards: await n('SELECT count(*) c FROM cards'),
    items: await n('SELECT count(*) c FROM card_items'),
    stats: await n('SELECT count(*) c FROM item_stats'),
    kv:    await n('SELECT count(*) c FROM kv'),
  };
  const oldest = (await q('SELECT min(created_at) m, max(created_at) x FROM cards')).rows[0];

  console.log('■ いまの状態');
  console.log(`   cards      ${before.cards} 件`);
  console.log(`   card_items ${before.items} 件`);
  console.log(`   item_stats ${before.stats} 件  ← ランキングの集計`);
  console.log(`   kv         ${before.kv} 件  （キャッシュ。消しません）`);
  if (before.cards) {
    console.log(`   作成日時   ${oldest.m} 〜 ${oldest.x}`);
  }

  // 消える対象の件数
  let target = before.cards;
  if (BEFORE) {
    target = await n('SELECT count(*) c FROM cards WHERE created_at < $1', [BEFORE]);
  }
  console.log('');
  console.log('■ 消える対象');
  console.log(`   カード     ${target} 件` + (BEFORE ? `（${BEFORE} より前に作られたもの）` : '（すべて）'));
  console.log(`   集計       ` + (BEFORE ? '残ったカードから積み直し' : `${before.stats} 件すべて`));

  if (!DO_IT) {
    console.log('');
    console.log('※ まだ何も消していません。実行するには --yes を付けてください。');
    console.log('   例: node tools/reset-cards.js --yes');
    await pool.end();
    return;
  }

  // ---- 実行 ----
  console.log('');
  console.log('■ 削除します');
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    if (BEFORE) {
      // card_items は cards の外部キーが ON DELETE CASCADE なので一緒に消える
      const r = await client.query('DELETE FROM cards WHERE created_at < $1', [BEFORE]);
      console.log(`   cards から ${r.rowCount} 件を削除`);

      // 部分削除では数え直す。残ったカードから積み直すのが確実。
      await client.query('DELETE FROM item_stats');
      await client.query(`
        INSERT INTO item_stats (type, source, external_id, lang, age_band,
                                title, sub, image_url, year, n)
        SELECT c.type, i.source, i.external_id,
               COALESCE(c.lang, ''),
               CASE WHEN c.born IS NULL THEN 0
                    ELSE ((EXTRACT(YEAR FROM now())::int - c.born) / 10) * 10 END,
               min(i.title), min(i.sub), min(i.image_url), min(i.year), count(*)
          FROM card_items i
          JOIN cards c ON c.id = i.card_id
         WHERE i.source IS NOT NULL AND i.external_id IS NOT NULL
         GROUP BY c.type, i.source, i.external_id, COALESCE(c.lang, ''),
                  CASE WHEN c.born IS NULL THEN 0
                       ELSE ((EXTRACT(YEAR FROM now())::int - c.born) / 10) * 10 END
      `);
      console.log('   item_stats を残ったカードから積み直しました');
    } else {
      const r = await client.query('DELETE FROM cards');
      console.log(`   cards から ${r.rowCount} 件を削除`);
      const s = await client.query('DELETE FROM item_stats');
      console.log(`   item_stats から ${s.rowCount} 件を削除`);
    }

    await client.query('COMMIT');
  } catch (e) {
    await client.query('ROLLBACK');
    console.error('失敗したので、何も変更せずに戻しました:', e.message);
    client.release();
    await pool.end();
    process.exit(1);
  }
  client.release();

  // ---- 結果 ----
  const after = {
    cards: await n('SELECT count(*) c FROM cards'),
    items: await n('SELECT count(*) c FROM card_items'),
    stats: await n('SELECT count(*) c FROM item_stats'),
    kv:    await n('SELECT count(*) c FROM kv'),
  };
  console.log('');
  console.log('■ 削除後');
  console.log(`   cards      ${before.cards} → ${after.cards}`);
  console.log(`   card_items ${before.items} → ${after.items}`);
  console.log(`   item_stats ${before.stats} → ${after.stats}`);
  console.log(`   kv         ${before.kv} → ${after.kv}（変更なし）`);
  await pool.end();
})().catch(e => {
  console.error('エラー:', e.message);
  process.exit(1);
});
