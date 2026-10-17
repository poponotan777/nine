// ============================================================
// 楽天市場の自動取得
//   午前:ランキング(各ジャンル1000位まで)+リアルタイム上位+ブランド半分+他サイト補完
//   午後:ランキング上位300位+リアルタイム上位+ブランド残り半分+他サイト補完
//   間隔:1.1秒に1回(楽天の上限は1秒1回)
//
//   楽天の新API(2026〜)は「許可したWebサイト」からの呼び出しだけ受け付けるため、
//   アプリに登録したサイト(oudan.vercel.app)を Referer/Origin として名乗る。
// ============================================================

import { RAKUTEN_ITEM_SEARCH_URL } from "../lib/rakutenEndpoint.js";
import { isSameProduct, normalizeName } from "../lib/merge.js";
import { BRANDS } from "./brands.js";
import { RAKUTEN_FALLBACK_GENRES, RAKUTEN_SKIP_GENRE } from "./genres.js";
import {
  Pacer, Writer, log, rpc, getState, setState, cleanText, cleanName, enrich, jstToIso,
  NOISE, shortQuery, pickSame,
} from "./core.js";

const RANK_URL = "https://openapi.rakuten.co.jp/ichibaranking/api/IchibaItem/Ranking/20220601";
const GENRE_URL = "https://openapi.rakuten.co.jp/ichibagt/api/IchibaGenre/Search/20260701";

function creds() {
  return {
    appId: process.env.RAKUTEN_SERVER_APP_ID || process.env.RAKUTEN_APP_ID || process.env.NEXT_PUBLIC_RAKUTEN_APP_ID || "",
    accessKey: process.env.RAKUTEN_SERVER_ACCESS_KEY || process.env.RAKUTEN_ACCESS_KEY || process.env.NEXT_PUBLIC_RAKUTEN_ACCESS_KEY || "",
    affiliateId: process.env.RAKUTEN_AFFILIATE_ID || process.env.NEXT_PUBLIC_RAKUTEN_AFFILIATE_ID || "",
    origin: (process.env.SITE_ORIGIN || "https://oudan.vercel.app").replace(/\/$/, ""),
  };
}

export function rakutenReady() {
  const c = creds();
  return !!(c.appId && c.accessKey);
}

function call(pacer, url, params, label) {
  const c = creds();
  const qs = new URLSearchParams({
    applicationId: c.appId,
    accessKey: c.accessKey,
    format: "json",
    formatVersion: "2",
    ...(c.affiliateId ? { affiliateId: c.affiliateId } : {}),
    ...params,
  });
  return pacer.fetchJson(`${url}?${qs}`, {
    headers: { Origin: c.origin, Referer: c.origin + "/" },
  }, { label });
}

const itemsOf = (j) => ((j && (j.Items || j.items)) || []).map((x) => x.Item || x);

function imageOf(it) {
  const m = it.mediumImageUrls?.[0];
  const u = typeof m === "string" ? m : m?.imageUrl;
  return u ? u.replace(/\?_ex=\d+x\d+/, "?_ex=300x300") : null;
}

// 楽天の商品1件 → DBに書く行
export function rakutenRow(it, extra = {}) {
  const code = it.itemCode;
  const rawName = cleanText(it.itemName, 300);
  const name = cleanName(it.itemName);
  const price = Number(it.itemPrice);
  if (!code || !name || !(price > 0) || NOISE.test(rawName)) return null;
  const pr = Number(it.pointRate) || null;
  const saleEnd = jstToIso(it.endTime);
  const row = {
    pkey: extra.pkey || `r:${code}`,
    store: "rakuten",
    code,
    name,
    image: imageOf(it),
    price,
    url: it.affiliateUrl || it.itemUrl || null,
    shop: it.shopName || null,
    point_rate: pr,
    point_until: pr && pr > 1 ? jstToIso(it.pointRateEndTime) : null,
    sale_until: saleEnd,
    sale_label: saleEnd ? "タイムセール" : pr && pr >= 2 ? `ポイント${pr}倍` : null,
    review_avg: Number(it.reviewAverage) || null,
    review_count: Number(it.reviewCount) || 0,
    catch: cleanText(it.catchcopy, 120) || null,
    genre: extra.genre || null,
  };
  if (extra.rank != null) { row.rank = extra.rank; row.rank_genre = extra.genre || null; }
  if (extra.rank_rt != null) row.rank_rt = extra.rank_rt;
  if (extra.aliases) row.aliases = extra.aliases;
  return enrich(row, { name: rawName, brandField: "", catchcopy: it.catchcopy, text: it.itemCaption });
}

async function loadGenres(pacer) {
  const st = await getState("rakuten_genres");
  if (st && st.value?.length && Date.now() - new Date(st.updated_at).getTime() < 7 * 86400000) return st.value;
  const r = await call(pacer, GENRE_URL, { genreId: "0" }, "ジャンル一覧");
  let list = [];
  if (r.ok && r.json) {
    const ch = r.json.children || r.json.Children || [];
    list = ch.map((c) => c.child || c)
      .map((c) => ({ id: String(c.genreId ?? c.id ?? ""), name: c.nameJa || c.genreName || c.name || "" }))
      .filter((g) => g.id && g.id !== "0");
  }
  if (list.length < 10) {
    log("[楽天] ジャンル一覧を取得できなかったので、内蔵の一覧を使います");
    list = RAKUTEN_FALLBACK_GENRES;
  } else {
    await setState("rakuten_genres", list);
  }
  return list.filter((g) => !RAKUTEN_SKIP_GENRE.test(g.name));
}

// ランキングを「1ページ目を全ジャンル → 2ページ目を全ジャンル…」の順に取る
// (時間切れでも、全ジャンルの上位は必ず取れる)
async function rankings(pacer, writer, genres, maxPage, { realtime = false } = {}) {
  const targets = [{ id: null, name: "総合" }, ...genres];
  const done = new Set();
  let items = 0;
  for (let page = 1; page <= maxPage; page++) {
    for (const g of targets) {
      if (done.has(g.name)) continue;
      if (!pacer.canGo()) return items;
      const params = { page: String(page) };
      if (g.id) params.genreId = g.id;
      if (realtime) params.period = "realtime";
      const r = await call(pacer, RANK_URL, params, `ランキング ${g.name} p${page}`);
      const list = r.ok ? itemsOf(r.json) : [];
      if (!r.ok || list.length === 0) { done.add(g.name); continue; }
      for (const it of list) {
        const rank = Number(it.rank) || null;
        const row = rakutenRow(it, realtime ? { rank_rt: rank, genre: g.id ? g.name : null } : { rank, genre: g.id ? g.name : null });
        if (row) { writer.add(row); items++; }
      }
      await writer.flushIfFull();
      if (list.length < 30) done.add(g.name);
    }
  }
  return items;
}

async function brandSearch(pacer, writer, brands) {
  let items = 0;
  for (const b of brands) {
    if (!pacer.canGo()) break;
    const r = await call(pacer, RAKUTEN_ITEM_SEARCH_URL, { keyword: b.q, hits: "30", sort: "standard", minPrice: "300" }, `ブランド ${b.q}`);
    for (const it of r.ok ? itemsOf(r.json) : []) {
      const row = rakutenRow(it);
      // ブランド名で検索しても、別ブランドの対応品が混ざるので、ブランド一致だけ残す
      if (row && row.is_brand) { writer.add(row); items++; }
    }
    await writer.flushIfFull();
  }
  return items;
}

// 他サイトで見つかった商品を、楽天でも探す
async function fill(pacer, writer, n) {
  if (!pacer.canGo()) return { tried: 0, found: 0 };
  let list = [];
  try { list = (await rpc("take_fill", { _store: "rakuten", _n: n })) || []; } catch (e) { log("[楽天] 補完の予約を読めません", String(e).slice(0, 120)); return { tried: 0, found: 0 }; }
  const results = [];
  let found = 0;
  for (const q of list) {
    if (!pacer.canGo()) break;
    let hit = null;
    if (q.code) {
      const r = await call(pacer, RAKUTEN_ITEM_SEARCH_URL, { itemCode: q.code }, `取り直し ${q.code}`);
      const it = r.ok ? itemsOf(r.json)[0] : null;
      if (it) hit = { it };
    } else {
      const keyword = q.jan || shortQuery(q.name, normalizeName);
      if (keyword && keyword.length >= 2) {
        const r = await call(pacer, RAKUTEN_ITEM_SEARCH_URL, { keyword, hits: "20", sort: "standard" }, `補完 ${keyword}`);
        const cands = (r.ok ? itemsOf(r.json) : []).map((it) => ({ it, name: it.itemName, price: Number(it.itemPrice), jan: null }));
        const best = pickSame(cands, q.name, isSameProduct, { jan: q.jan });
        if (best) hit = best;
      }
    }
    if (hit) {
      const natural = `r:${hit.it.itemCode}`;
      const row = rakutenRow(hit.it, { pkey: q.pkey, aliases: natural !== q.pkey ? [natural] : undefined });
      if (row) { writer.add(row); found++; }
    }
    results.push({ pkey: q.pkey, store: "rakuten", found: !!hit });
    await writer.flushIfFull();
  }
  await writer.flush();
  try { await rpc("fill_done", { _items: results }); } catch {}
  return { tried: results.length, found };
}

export async function runRakuten({ clock, slot, day, noNew, dryRun }) {
  const stat = { store: "rakuten", requests: 0, items: 0, errors: 0, note: "" };
  if (!rakutenReady()) { stat.note = "楽天のキーが未設定のためスキップ"; log("[楽天]", stat.note); return stat; }
  const pacer = new Pacer("楽天", Number(process.env.RAKUTEN_INTERVAL_MS || 1100), clock);
  const writer = new Writer("rakuten", { day, noNew, dryRun });
  const am = slot === "am";
  try {
    if (slot === "fill") {
      // 補完だけの回(v24):残り時間で回せる件数だけ予約から取り出す
      const n = Math.min(Number(process.env.RAKUTEN_FILL_ONLY || 3000), Math.floor((clock.left() - 30000) / pacer.interval));
      const f = await fill(pacer, writer, Math.max(n, 0));
      stat.note = `補完だけの回 ${f.found}/${f.tried}件`;
      return await finish();
    }
    const genres = await loadGenres(pacer);
    log(`[楽天] ジャンル ${genres.length}件`);
    const maxPage = Number(am ? process.env.RAKUTEN_RANK_PAGES_AM || 34 : process.env.RAKUTEN_RANK_PAGES_PM || 10);
    stat.items += await rankings(pacer, writer, genres, maxPage);
    await writer.flush();
    const rankingComplete = !pacer.stopped;
    stat.items += await rankings(pacer, writer, genres, Number(process.env.RAKUTEN_RT_PAGES || 3), { realtime: true });
    await writer.flush();
    // 午前のランキングを最後まで取れたら、今日ランキングに出なかった商品の順位を外す
    if (am && rankingComplete && !dryRun) {
      try { const n = await rpc("finish_ranking", { _store: "rakuten", _day: day }); log(`[楽天] ランキング圏外になった商品 ${n}件`); } catch (e) { log("[楽天] finish_ranking 失敗", String(e).slice(0, 120)); }
    }
    const half = BRANDS.slice(0, Number(process.env.BRAND_LIMIT || BRANDS.length)).filter((_, i) => i % 2 === (am ? 0 : 1));
    stat.items += await brandSearch(pacer, writer, half);
    await writer.flush();
    const f = await fill(pacer, writer, Number(process.env.RAKUTEN_FILL || 400));
    stat.note = `補完 ${f.found}/${f.tried}件`;
  } catch (e) {
    stat.note = "エラー: " + String(e).slice(0, 200);
    log("[楽天]", stat.note);
  }
  return await finish();
  async function finish() {
  await writer.flush();
  stat.requests = pacer.requests;
  stat.errors = pacer.errors;
  stat.written = writer.written;
  if (pacer.stopReason) stat.note += ` / ${pacer.stopReason}`;
  log(`[楽天] 完了 リクエスト${stat.requests}回 書き込み${writer.written}件 ${stat.note}`);
  return stat;
  }
}
