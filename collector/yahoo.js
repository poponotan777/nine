// ============================================================
// Yahoo!ショッピングの自動取得
//   午前:高評価トレンドランキング(総合+各ジャンル1000位まで)+急上昇キーワード+ブランド半分+補完
//   午後:ランキング上位300位+急上昇キーワード+ブランド残り半分+補完
//   間隔:2.1秒に1回(Yahoo!は1分30回まで。超えると0件が返る)
//
//   ※「売れ筋順」の並べ替えはAPIに無いため、注文数と評価を合わせた
//     「高評価トレンドランキング」を売れ筋として使う
//   ※ ジャンルの一覧は、取得した商品の「親ジャンル」から自動で覚える(7日ごとに更新)
// ============================================================

import { isSameProduct, normalizeName } from "../lib/merge.js";
import { BRANDS } from "./brands.js";
import {
  Pacer, Writer, log, rpc, getState, setState, cleanText, cleanName, enrich, jstToIso,
  NOISE, isJan, shortQuery, pickSame,
} from "./core.js";

const BASE = "https://shopping.yahooapis.jp/ShoppingWebService";
const RANK_URL = `${BASE}/V1/highRatingTrendRanking`;
const SEARCH_URL = `${BASE}/V3/itemSearch`;
const QUERY_RANK_URL = `${BASE}/V2/queryRanking`;

const appid = () => process.env.YAHOO_CLIENT_ID || "";

// バリューコマース(Yahoo!ショッピングの成果)のリンクにする
function vcWrap(url) {
  const sid = process.env.VC_SID, pid = process.env.VC_PID;
  if (!url || !sid || !pid || /valuecommerce\.com/.test(url)) return url || null;
  return `https://ck.jp.ap.valuecommerce.com/servlet/referral?sid=${sid}&pid=${pid}&vc_url=${encodeURIComponent(url)}`;
}
export const yahooReady = () => !!appid();

function call(pacer, url, params, label) {
  const qs = new URLSearchParams({ appid: appid(), ...params });
  return pacer.fetchJson(`${url}?${qs}`, {}, { label });
}

const num = (v) => (v == null || v === "" ? null : Number(v));

// 商品検索(V3)の1件 → 行
export function yahooSearchRow(h, extra = {}) {
  const rawName = cleanText(h.name, 300);
  const name = cleanName(h.name);
  const price = num(h.price);
  if (!h.code || !name || !(price > 0) || NOISE.test(rawName)) return null;
  const jan = isJan(h.janCode) ? h.janCode : null;
  const pl = h.priceLabel || {};
  const def = num(pl.defaultPrice);
  const onSale = def && def > price;
  const bonus = num(h.point?.lyLimitedBonusAmount) || num(h.point?.bonusAmount) || null;
  const row = {
    pkey: extra.pkey || (jan || `y:${h.code}`),
    store: "yahoo",
    code: h.code,
    name,
    jan,
    image: h.image?.medium || null,
    price,
    list_price: onSale ? def : null,
    url: vcWrap(h.url),
    shop: h.seller?.name || null,
    point_rate: bonus && price ? Math.round((bonus / price) * 1000) / 10 : null,
    sale_until: onSale ? jstToIso(pl.periodEnd) : null,
    sale_label: onSale ? "セール" : null,
    review_avg: num(h.review?.rate),
    review_count: num(h.review?.count) || 0,
    brand: h.brand?.name ? cleanText(h.brand.name, 60) : null,
    genre: h.genreCategory?.name || extra.genre || null,
    catch: cleanText(h.headLine, 120) || null,
  };
  if (extra.trend_hint) row.trend_hint = extra.trend_hint;
  if (extra.aliases && extra.aliases.length) row.aliases = extra.aliases;
  if (extra.merge_from) row.merge_from = extra.merge_from;
  return enrich(row, { name: rawName, brandField: h.brand?.name, catchcopy: h.headLine, text: h.description });
}

// 高評価トレンドランキングの1件 → 行
export function yahooRankRow(d, extra = {}) {
  const ii = d.item_information || d.itemInformation || {};
  const rawName = cleanText(ii.name, 300);
  const name = cleanName(ii.name);
  const regular = num(ii.regular_price);
  const bargain = num(ii.bargain_price);
  const price = bargain && bargain > 0 ? bargain : regular;
  if (!ii.code || !name || !(price > 0) || NOISE.test(rawName)) return null;
  const jan = isJan(ii.jan_code) ? ii.jan_code : null;
  const row = {
    pkey: jan || `y:${ii.code}`,
    store: "yahoo",
    code: ii.code,
    name,
    jan,
    image: d.image?.medium || null,
    price,
    list_price: regular && price < regular ? regular : null,
    url: vcWrap(ii.url),
    shop: d.seller?.name || null,
    review_avg: num(d.review?.rate),
    review_count: num(d.review?.count) || 0,
    genre: extra.genre || null,
    rank: num(d.rank),
    rank_genre: extra.genre || "総合",
  };
  return enrich(row, { name: rawName, brandField: "", catchcopy: "", text: "" });
}

const rankList = (j) => {
  const root = j?.high_rating_trend_ranking || j?.highRatingTrendRanking || j || {};
  const list = root.ranking_data || root.rankingData || [];
  return Array.isArray(list) ? list : Object.values(list);
};

// 商品検索の結果から、第1階層のジャンル(親ジャンル)を覚える
const seenGenres = new Map();
function harvestGenres(hits) {
  for (const h of hits || []) {
    const parents = h.parentGenreCategories || [];
    const top = parents.find((p) => Number(p.depth) === 1);
    if (top && top.id) seenGenres.set(String(top.id), top.name || "");
  }
}

async function loadGenres() {
  const st = await getState("yahoo_genres");
  return st && Array.isArray(st.value) ? st.value : [];
}

async function rankings(pacer, writer, genres, maxOffset) {
  const targets = [{ id: null, name: "総合" }, ...genres];
  const done = new Set();
  let items = 0;
  for (let offset = 1; offset <= maxOffset; offset += 100) {
    for (const g of targets) {
      if (done.has(g.name)) continue;
      if (!pacer.canGo()) return items;
      const params = { offset: String(offset), limit: "100" };
      if (g.id) params.genre_category_id = g.id;
      const r = await call(pacer, RANK_URL, params, `ランキング ${g.name} ${offset}`);
      const list = r.ok ? rankList(r.json) : [];
      if (!r.ok || list.length === 0) { done.add(g.name); continue; }
      for (const d of list) {
        const row = yahooRankRow(d, { genre: g.id ? g.name : null });
        if (row) { writer.add(row); items++; }
      }
      await writer.flushIfFull();
      if (list.length < 100) done.add(g.name);
    }
  }
  return items;
}

const hitsOf = (j) => (j && Array.isArray(j.hits) ? j.hits : []);

// 急上昇キーワード → その言葉の上位商品に「急上昇」の印を付ける
async function risingKeywords(pacer, writer, n) {
  const r = await call(pacer, QUERY_RANK_URL, { type: "up" }, "急上昇キーワード");
  const root = r.json?.keyword_ranking || r.json || {};
  const list = (root.ranking_data || []).map((d) => d.query).filter(Boolean).slice(0, n);
  let items = 0;
  for (let i = 0; i < list.length; i++) {
    if (!pacer.canGo()) break;
    const s = await call(pacer, SEARCH_URL, { query: list[i], results: "20", sort: "-score" }, `急上昇 ${list[i]}`);
    const hits = s.ok ? hitsOf(s.json) : [];
    harvestGenres(hits);
    for (const h of hits.slice(0, 10)) {
      const row = yahooSearchRow(h, { trend_hint: Math.max(50, 600 - i * 12) });
      if (row) { writer.add(row); items++; }
    }
    await writer.flushIfFull();
  }
  return items;
}

async function brandSearch(pacer, writer, brands) {
  let items = 0;
  for (const b of brands) {
    if (!pacer.canGo()) break;
    const r = await call(pacer, SEARCH_URL, { query: b.q, results: "50", sort: "-score", price_from: "300" }, `ブランド ${b.q}`);
    const hits = r.ok ? hitsOf(r.json) : [];
    harvestGenres(hits);
    for (const h of hits) {
      const row = yahooSearchRow(h);
      if (row && row.is_brand) { writer.add(row); items++; }
    }
    await writer.flushIfFull();
  }
  return items;
}

async function fill(pacer, writer, n) {
  if (!pacer.canGo()) return { tried: 0, found: 0 };
  let list = [];
  try { list = (await rpc("take_fill", { _store: "yahoo", _n: n })) || []; } catch (e) { log("[Yahoo!] 補完の予約を読めません", String(e).slice(0, 120)); return { tried: 0, found: 0 }; }
  const results = [];
  let found = 0;
  for (const q of list) {
    if (!pacer.canGo()) break;
    const params = { results: "20", sort: "+price" };
    if (q.jan) params.jan_code = q.jan;
    else params.query = shortQuery(q.name, normalizeName);
    if (!params.jan_code && !(params.query && params.query.length >= 2)) {
      results.push({ pkey: q.pkey, store: "yahoo", found: false });
      continue;
    }
    const r = await call(pacer, SEARCH_URL, params, `補完 ${params.jan_code || params.query}`);
    const hits = r.ok ? hitsOf(r.json) : [];
    let best = null;
    if (q.code) best = hits.find((h) => h.code === q.code) ? { h: hits.find((h) => h.code === q.code) } : null;
    if (!best) {
      const cands = hits.map((h) => ({ h, name: h.name, price: num(h.price), jan: isJan(h.janCode) ? h.janCode : null }));
      best = pickSame(cands, q.name, isSameProduct, { jan: q.jan });
    }
    if (best) {
      const h = best.h;
      const hj = isJan(h.janCode) ? h.janCode : null;
      // JANが分かったら、JANを正式なキーにして元の商品をまとめる
      const target = !isJan(q.pkey) && hj ? hj : q.pkey;
      const natural = hj || `y:${h.code}`;
      const row = yahooSearchRow(h, {
        pkey: target,
        merge_from: target !== q.pkey ? [q.pkey] : undefined,
        aliases: [natural, `y:${h.code}`].filter((k, i, arr) => k !== target && arr.indexOf(k) === i),
      });
      if (row) { writer.add(row); found++; }
    }
    results.push({ pkey: q.pkey, store: "yahoo", found: !!best });
    await writer.flushIfFull();
  }
  await writer.flush();
  try { await rpc("fill_done", { _items: results }); } catch {}
  return { tried: results.length, found };
}

export async function runYahoo({ clock, slot, day, noNew, dryRun }) {
  const stat = { store: "yahoo", requests: 0, items: 0, errors: 0, note: "" };
  if (!yahooReady()) { stat.note = "Yahoo!のキーが未設定のためスキップ"; log("[Yahoo!]", stat.note); return stat; }
  const pacer = new Pacer("Yahoo!", Number(process.env.YAHOO_INTERVAL_MS || 1100), clock);
  const writer = new Writer("yahoo", { day, noNew, dryRun });
  const am = slot === "am";
  try {
    if (slot === "fill") {
      const n = Math.min(Number(process.env.YAHOO_FILL_ONLY || 3000), Math.floor((clock.left() - 30000) / pacer.interval));
      const f = await fill(pacer, writer, Math.max(n, 0));
      stat.note = `補完だけの回 ${f.found}/${f.tried}件`;
      return await finish();
    }
    const genres = await loadGenres();
    log(`[Yahoo!] ジャンル ${genres.length}件`);
    const maxOffset = am ? Number(process.env.YAHOO_RANK_MAX_AM || 1000) : Number(process.env.YAHOO_RANK_MAX_PM || 300);
    stat.items += await rankings(pacer, writer, genres, maxOffset);
    await writer.flush();
    const rankingComplete = !pacer.stopped;
    stat.items += await risingKeywords(pacer, writer, Number(process.env.YAHOO_RISING || 40));
    await writer.flush();
    if (am && rankingComplete && !dryRun) {
      try { const n = await rpc("finish_ranking", { _store: "yahoo", _day: day }); log(`[Yahoo!] ランキング圏外になった商品 ${n}件`); } catch (e) { log("[Yahoo!] finish_ranking 失敗", String(e).slice(0, 120)); }
    }
    const half = BRANDS.slice(0, Number(process.env.BRAND_LIMIT || BRANDS.length)).filter((_, i) => i % 2 === (am ? 0 : 1));
    stat.items += await brandSearch(pacer, writer, half);
    await writer.flush();
    const f = await fill(pacer, writer, Number(process.env.YAHOO_FILL || 250));
    stat.note = `補完 ${f.found}/${f.tried}件`;
    // 覚えたジャンルを保存(次回からジャンル別ランキングに使う)
    if (seenGenres.size >= 5 && !dryRun) {
      const merged = new Map(genres.map((g) => [g.id, g.name]));
      for (const [id, name] of seenGenres) merged.set(id, name);
      await setState("yahoo_genres", [...merged].map(([id, name]) => ({ id, name })).slice(0, 40));
    }
  } catch (e) {
    stat.note = "エラー: " + String(e).slice(0, 200);
    log("[Yahoo!]", stat.note);
  }
  return await finish();
  async function finish() {
  await writer.flush();
  stat.requests = pacer.requests;
  stat.errors = pacer.errors;
  stat.written = writer.written;
  if (pacer.stopReason) stat.note += ` / ${pacer.stopReason}`;
  log(`[Yahoo!] 完了 リクエスト${stat.requests}回 書き込み${writer.written}件 ${stat.note}`);
  return stat;
  }
}
