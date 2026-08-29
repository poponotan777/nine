/**
 * ads.js — 広告の出し分け
 *
 * 2種類の広告を、別々の環境変数で管理する。
 *
 *   ADSENSE_JSON  … アドセンス。サイト単位の同じコードを全ページで使う
 *   ADS_JSON      … アフィリエイト。ページごとに違う案件を出す
 *
 * 置き場所は5つ。
 *   rail    PC画面の右（アドセンス想定・全ページ共通）
 *   rail2   PC画面の左（アドセンス想定・全ページ共通）
 *   bar     下部からせり出す枠（アドセンス想定・全ページ共通）
 *   inflow  本文内 300×250（アフィリエイト・ページごと）
 *   inflow2 本文内 300×250 の2枠目（アフィリエイト・ページごと）
 *
 * ADSENSE_JSON はページ名を書かず、置き場所だけを指定する:
 *   {"rail":"<アドセンスのコード>","rail2":"<同左>","bar":"<同左>"}
 *   言語で分けたいときは "rail_en" のように末尾を付ける。
 *
 * ADS_JSON はこれまでどおり {ページ}_{場所}_{言語} の形:
 *   {"book_inflow":"<DMMブックス>","movie_inflow":"<TSUTAYA>"}
 *
 * 値を配列にすると、その中からランダムで1つ選ぶ（半々表示に使える）。
 */

function safeJSON(t) { try { return JSON.parse(t); } catch { return {}; } }

const ADS     = safeJSON(process.env.ADS_JSON || '{}');
const ADSENSE = safeJSON(process.env.ADSENSE_JSON || '{}');

function pick(v) {
  if (Array.isArray(v)) return v.length ? v[Math.floor(Math.random() * v.length)] : '';
  return v || '';
}

/** アドセンス。ページを問わず同じものを返す */
function adsenseSlot(place, lang) {
  for (const k of [`${place}_${lang}`, place]) {
    if (ADSENSE[k] != null) return pick(ADSENSE[k]);
  }
  return '';
}

/** アフィリエイト。ページごとに切り替える */
function affiliateSlot(kind, place, lang) {
  const keys = [
    `${kind}_${place}_${lang}`,
    `${kind}_${place}`,
    `common_${place}_${lang}`,
    `common_${place}`,
  ];
  for (const k of keys) if (ADS[k] != null) return pick(ADS[k]);
  return '';
}

/**
 * 両方をまとめて返す。
 * 左右と下部はアドセンスを優先し、無ければアフィリエイトで埋める。
 * 本文内はアフィリエイトを優先し、無ければアドセンスで埋める。
 */
function adsFor(kind, lang = 'ja') {
  const L = lang === 'en' ? 'en' : 'ja';
  const both = (place, adsenseFirst) => {
    const a = adsenseSlot(place, L);
    const f = affiliateSlot(kind, place, L);
    return adsenseFirst ? (a || f) : (f || a);
  };
  return {
    rail:     both('rail', true),
    railLeft: both('rail2', true),
    bar:      both('bar', true),
    inflow:   both('inflow', false),
    inflow2:  both('inflow2', false),
  };
}

module.exports = {
  adsFor,
  hasAds: () => Object.keys(ADS).length > 0 || Object.keys(ADSENSE).length > 0,
};
