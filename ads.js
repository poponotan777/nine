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

const fs   = require('fs');
const path = require('path');

function safeJSON(t) { try { return JSON.parse(t); } catch { return {}; } }

/**
 * 設定の読み込み。環境変数を優先し、無ければ同梱のJSONファイルを読む。
 *
 * アドセンスのコードは pub-ID もスロットIDもページのHTMLに出るので秘密ではない。
 * 環境変数に入れると1900文字を1行に押し込むことになり、
 * 引用符と改行で壊れやすい（ADS-SETUP.md と HANDOVER.md §8 の事故）。
 * ファイルなら整形したまま置けて、変更履歴もGitに残る。
 *
 * 環境変数のほうが優先なので、ファイルを触らずに一時的に差し替えることもできる。
 * 逆に「ファイルの内容を無効にしたい」ときは、環境変数に {} を入れる。
 */
function loadConfig(envName, file) {
  const fromEnv = process.env[envName];
  if (fromEnv) return safeJSON(fromEnv);
  try {
    return JSON.parse(fs.readFileSync(path.join(__dirname, file), 'utf8'));
  } catch (e) {
    if (e.code !== 'ENOENT') console.warn(`${file} を読めませんでした: ${e.message}`);
    return {};
  }
}

const ADS     = loadConfig('ADS_JSON', 'ads.json');
const ADSENSE = loadConfig('ADSENSE_JSON', 'adsense.json');

function pick(v) {
  if (Array.isArray(v)) return v.length ? v[Math.floor(Math.random() * v.length)] : '';
  return v || '';
}

/** アドセンス。
 *  もとは置き場所だけを見ていた（全ページ共通）。
 *  「キャラのページの本文内だけアドセンスを出す」といった指定ができるよう、
 *  ページ名つきのキーを先に探すようにした。
 *    character_inflow_ja → character_inflow → inflow_ja → inflow
 *  ページ名を書かなければ、これまでどおり全ページ共通で効く。 */
function adsenseSlot(kind, place, lang) {
  for (const k of [`${kind}_${place}_${lang}`, `${kind}_${place}`,
                   `${place}_${lang}`, place]) {
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
 *
 * 「優先されなかったほう」も *Alt として一緒に返す。
 * アドセンスは枠を作っても広告が入らない（data-ad-status="unfilled"）ことがあり、
 * そのときに画面側でアフィリエイトへ差し替えるために使う。
 * ここの判定はキーの有無しか見ないので、配信されたかどうかは分からない。
 */
function adsFor(kind, lang = 'ja') {
  const L = lang === 'en' ? 'en' : 'ja';
  // [実際に出すもの, 出なかったときの代わり] を返す
  const both = (place, adsenseFirst) => {
    const a = adsenseSlot(kind, place, L);
    const f = affiliateSlot(kind, place, L);
    if (adsenseFirst) return [a || f, a && f ? f : ''];
    return [f || a, f && a ? a : ''];
  };
  const [rail, railAlt]         = both('rail', true);
  const [railLeft, railLeftAlt] = both('rail2', true);
  const [bar, barAlt]           = both('bar', true);
  const [inflow, inflowAlt]     = both('inflow', false);
  const [inflow2, inflow2Alt]   = both('inflow2', false);
  return {
    rail, railAlt,
    railLeft, railLeftAlt,
    bar, barAlt,
    inflow, inflowAlt,
    inflow2, inflow2Alt,
  };
}

module.exports = {
  adsFor,
  hasAds: () => Object.keys(ADS).length > 0 || Object.keys(ADSENSE).length > 0,
};
