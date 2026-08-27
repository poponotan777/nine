/**
 * ads.js — 広告の出し分け
 *
 * 方針:
 *   1. 9つを選び終えた人が「その作品にもっと触れたい」と思う導線だけを置く
 *   2. 作る流れと共有の導線には出さない（詳細・レール・本文内・trends のみ）
 *   3. 文脈と無関係な案件は置かない
 *
 * 環境変数 ADS_JSON にバナーHTMLをJSONで渡す。未設定なら枠ごと消える。
 *
 * キーの形: {種類}_{場所}_{言語}   ← 言語は省略可
 *   種類  book / manga / cd / anime / movie / person / character / trends / about / common
 *   場所  rail（PC右）/ rail2（PC左）/ inflow（本文内）/ bar（スマホ下部）
 *   言語  ja / en
 *
 * 探す順番は次のとおり。見つかった時点で採用する。
 *   book_rail_ja → book_rail → common_rail_ja → common_rail
 *
 * 値を配列にすると、その中からランダムで1つ選ぶ。
 * アフィリエイトとアドセンスを半々で出したいときはこう書く:
 *   "book_inflow_ja": ["<A8のバナー>", "<アドセンスのコード>"]
 */

function safeJSON(t) { try { return JSON.parse(t); } catch { return {}; } }

const ADS = safeJSON(process.env.ADS_JSON || '{}');

/** 配列なら1つ選ぶ。文字列ならそのまま */
function pick(v) {
  if (Array.isArray(v)) return v.length ? v[Math.floor(Math.random() * v.length)] : '';
  return v || '';
}

function slot(kind, place, lang) {
  const keys = [
    `${kind}_${place}_${lang}`,
    `${kind}_${place}`,
    `common_${place}_${lang}`,
    `common_${place}`,
  ];
  for (const k of keys) if (ADS[k] != null) return pick(ADS[k]);
  return '';
}

/** 画面に渡す広告一式 */
function adsFor(kind, lang = 'ja') {
  const L = lang === 'en' ? 'en' : 'ja';
  return {
    rail:     slot(kind, 'rail', L),
    railLeft: slot(kind, 'rail2', L),
    inflow:   slot(kind, 'inflow', L),
    bar:      slot(kind, 'bar', L),
  };
}

module.exports = { adsFor, hasAds: () => Object.keys(ADS).length > 0 };
