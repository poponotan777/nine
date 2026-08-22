/**
 * ads.js — 広告の出し分け
 *
 * 方針:
 *   1. 9つを選び終えた人が「その作品にもっと触れたい」と思う導線だけを置く
 *   2. 作る流れと共有の導線には出さない（詳細・レール・trends のみ）
 *   3. 文脈と無関係な案件は置かない。数字が出ないうえ、体験を汚す
 *
 * バナーHTMLは環境変数 ADS_JSON で渡す。未設定なら何も表示されない。
 *
 *   ADS_JSON='{"book_rail":"<a href=...>...</a>","movie_bar":"..."}'
 *
 * キーの命名: {種類}_{場所}
 *   種類: book / manga / cd / anime / movie / person / character / trends / common
 *   場所: rail（PC横）/ bar（スマホ下部）/ detail（作品の詳細）
 */

function safeJSON(t) { try { return JSON.parse(t); } catch { return {}; } }

const ADS = safeJSON(process.env.ADS_JSON || '{}');

/** 種類と場所に合うバナーHTMLを返す。無ければ共通、それも無ければ空 */
function slot(kind, place) {
  return ADS[`${kind}_${place}`] || ADS[`common_${place}`] || '';
}

/** 画面に渡す広告一式。HTMLをそのまま埋め込む */
function adsFor(kind) {
  return {
    rail:     slot(kind, 'rail'),
    railLeft: ADS[`${kind}_rail2`] || ADS['common_rail2'] || '',
    bar:      slot(kind, 'bar'),
    // 本文の流れの中（スマホ向け）。バナーよりレクタングルが馴染む
    inflow:   ADS[`${kind}_inflow`] || ADS['common_inflow'] || '',
  };
}

/**
 * 案件選定の指針（実際のバナーはA8等で発行して ADS_JSON に入れる）
 *
 *   book / manga  … BOOK☆WALKER、audiobook.jp、Kindle Unlimited、コミックシーモア
 *   cd            … Amazon Music、楽天ミュージック
 *   anime         … ABEMAプレミアム、DMM TV
 *   movie         … U-NEXT、DMM TV、ゲオ宅配レンタル
 *   trends        … TSUTAYA DISCAS、ゲオ宅配レンタル
 *   person /
 *   character     … 該当する商材が無い。common を出すか、空のままでよい
 *
 * 承認率の低い案件（無料期間だけで解約されると否認など）は
 * 表示報酬額だけで選ばないこと。成果条件を必ず読む。
 */

module.exports = { adsFor, hasAds: () => Object.keys(ADS).length > 0 };
