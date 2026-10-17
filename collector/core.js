// ============================================================
// 自動取得(collector)の共通部品
//   ・Supabase への書き込み(record_offers などの関数呼び出し)
//   ・APIごとの間隔あけ(楽天1.1秒 / Yahoo! 2.1秒 / Amazon 1.2秒)
//   ・時間切れの管理(GitHub Actions の無料枠を使い切らないため)
// 外部ライブラリは使わない(Node 20 以上の fetch だけで動く)
// ============================================================

import { detectPains } from "../lib/pains.js";
import { matchBrand } from "./brands.js";

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// JSTの日付(YYYY-MM-DD)
export function jstDay(d = new Date()) {
  return new Date(d.getTime() + 9 * 3600 * 1000).toISOString().slice(0, 10);
}
export function jstHour(d = new Date()) {
  return new Date(d.getTime() + 9 * 3600 * 1000).getUTCHours();
}

// ---------- 時間の管理 ----------
export class Clock {
  constructor(minutes) {
    this.start = Date.now();
    this.end = this.start + minutes * 60 * 1000;
  }
  left() { return this.end - Date.now(); }
  // 残りが ms 未満なら true(新しい作業を始めない)
  nearlyOut(ms = 20000) { return this.left() < ms; }
  elapsedMin() { return Math.round((Date.now() - this.start) / 600) / 100; }
}

// ---------- API呼び出しの間隔あけ+再試行 ----------
export class Pacer {
  constructor(name, intervalMs, clock, { maxRequests = Infinity } = {}) {
    this.name = name;
    this.interval = intervalMs;
    this.clock = clock;
    this.last = 0;
    this.requests = 0;
    this.errors = 0;
    this.maxRequests = maxRequests;
    this.stopped = false;
    this.stopReason = "";
  }
  canGo() {
    if (this.stopped) return false;
    if (this.requests >= this.maxRequests) { this.stop("1日の上限回数に達した"); return false; }
    if (this.clock.nearlyOut()) { this.stop("時間切れ"); return false; }
    return true;
  }
  stop(reason) {
    if (!this.stopped) {
      this.stopped = true;
      this.stopReason = reason;
      log(`[${this.name}] 停止: ${reason}`);
    }
  }
  async wait() {
    const w = this.interval - (Date.now() - this.last);
    if (w > 0) await sleep(w);
    this.last = Date.now();
  }
  // fetch を間隔つきで呼ぶ。429/5xx は待って再試行。戻り値 {ok, status, json}
  async fetchJson(url, init = {}, { retries = 3, label = "" } = {}) {
    for (let attempt = 0; attempt <= retries; attempt++) {
      if (!this.canGo()) return { ok: false, status: -1, json: null, stopped: true };
      await this.wait();
      this.requests++;
      let res, text = "";
      try {
        const ctrl = new AbortController();
        const t = setTimeout(() => ctrl.abort(), 25000);
        res = await fetch(url, { ...init, signal: ctrl.signal });
        clearTimeout(t);
        text = await res.text();
      } catch (e) {
        this.errors++;
        if (attempt < retries) { await sleep(2000 * (attempt + 1)); continue; }
        return { ok: false, status: 0, json: null, error: String(e) };
      }
      let json = null;
      try { json = text ? JSON.parse(text) : null; } catch {}
      if (res.ok) return { ok: true, status: res.status, json };
      if (res.status === 429 || res.status >= 500) {
        this.errors++;
        if (attempt < retries) { await sleep([4000, 10000, 25000, 40000][attempt] || 40000); continue; }
      }
      if (res.status === 401 || res.status === 403) {
        this.errors++;
        log(`[${this.name}] 認証/権限エラー ${res.status} ${label}: ${text.slice(0, 300)}`);
      } else if (res.status !== 404) {
        this.errors++;
        log(`[${this.name}] HTTP ${res.status} ${label}: ${text.slice(0, 200)}`);
      }
      return { ok: false, status: res.status, json, text };
    }
    return { ok: false, status: 0, json: null };
  }
}

// ---------- ログ ----------
export function log(...a) {
  const t = new Date(Date.now() + 9 * 3600 * 1000).toISOString().slice(11, 19);
  console.log(`[${t}]`, ...a);
}

// ---------- Supabase ----------
const SB_URL = (process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || "").replace(/\/$/, "");
const SB_KEY = process.env.SUPABASE_SECRET_KEY || "";

export function dbReady() {
  return !!(SB_URL && SB_KEY);
}

export async function rpc(fn, args, { retries = 3 } = {}) {
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const res = await fetch(`${SB_URL}/rest/v1/rpc/${fn}`, {
        method: "POST",
        headers: {
          apikey: SB_KEY,
          Authorization: `Bearer ${SB_KEY}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(args || {}),
      });
      const text = await res.text();
      if (res.ok) {
        try { return text ? JSON.parse(text) : null; } catch { return text; }
      }
      if (attempt < retries && (res.status >= 500 || res.status === 429)) {
        await sleep(3000 * (attempt + 1));
        continue;
      }
      throw new Error(`DB ${fn} HTTP ${res.status}: ${text.slice(0, 300)}`);
    } catch (e) {
      if (attempt < retries && !/HTTP 4/.test(String(e))) {
        await sleep(3000 * (attempt + 1));
        continue;
      }
      throw e;
    }
  }
}

// テーブルの読み書き(collector_state など小さなもの用)
export async function rest(path, { method = "GET", body, prefer } = {}) {
  const res = await fetch(`${SB_URL}/rest/v1/${path}`, {
    method,
    headers: {
      apikey: SB_KEY,
      Authorization: `Bearer ${SB_KEY}`,
      "Content-Type": "application/json",
      ...(prefer ? { Prefer: prefer } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`DB ${method} ${path} HTTP ${res.status}: ${text.slice(0, 200)}`);
  try { return text ? JSON.parse(text) : null; } catch { return text; }
}

export async function getState(key) {
  try {
    const rows = await rest(`collector_state?key=eq.${encodeURIComponent(key)}&select=value,updated_at`);
    return rows && rows[0] ? rows[0] : null;
  } catch { return null; }
}
export async function setState(key, value) {
  try {
    await rest("collector_state?on_conflict=key", {
      method: "POST",
      body: [{ key, value, updated_at: new Date().toISOString() }],
      prefer: "resolution=merge-duplicates",
    });
  } catch (e) { log("state保存失敗", key, String(e).slice(0, 120)); }
}

// ---------- まとめ書き込み ----------
// 行をためて500件ずつ record_offers に送る
export class Writer {
  constructor(store, { day, noNew = false, dryRun = false } = {}) {
    this.store = store;
    this.day = day;
    this.noNew = noNew;
    this.dryRun = dryRun;
    this.buf = [];
    this.written = 0;
    this.seen = new Map(); // 同じ実行で同じ商品が何度も来たら、良い情報で1件にまとめる
  }
  add(row) {
    if (!row || !row.pkey || !(row.price > 0)) return;
    const id = `${row.pkey}|${row.store}`;
    const prev = this.seen.get(id);
    if (prev) {
      // 同じ実行内で重複:安い価格・良い順位を残し、ランキング情報は保持
      if (row.price < prev.price) prev.price = row.price;
      if (row.rank != null && (prev.rank == null || row.rank < prev.rank)) { prev.rank = row.rank; prev.rank_genre = row.rank_genre; }
      if (row.rank_rt != null && (prev.rank_rt == null || row.rank_rt < prev.rank_rt)) prev.rank_rt = row.rank_rt;
      if (row.trend_hint && (!prev.trend_hint || row.trend_hint > prev.trend_hint)) prev.trend_hint = row.trend_hint;
      if (row.aliases) prev.aliases = [...new Set([...(prev.aliases || []), ...row.aliases])];
      if (row.merge_from) prev.merge_from = [...new Set([...(prev.merge_from || []), ...row.merge_from])];
      prev.is_brand = prev.is_brand || row.is_brand;
      return;
    }
    this.seen.set(id, row);
    this.buf.push(row);
  }
  async flushIfFull() {
    if (this.buf.length >= 500) await this.flush();
  }
  async flush() {
    if (this.buf.length === 0) return;
    const chunk = this.buf.splice(0, this.buf.length);
    if (this.dryRun) { this.written += chunk.length; return; }
    for (let i = 0; i < chunk.length; i += 500) {
      const part = chunk.slice(i, i + 500);
      try {
        const n = await rpc("record_offers", { _rows: part, _day: this.day, _no_new: this.noNew });
        this.written += typeof n === "number" ? n : part.length;
      } catch (e) {
        log(`[${this.store}] 書き込み失敗(${part.length}件):`, String(e).slice(0, 300));
      }
    }
    // 次の重複チェックは新しい行だけ対象にする(メモリ節約)
    if (this.seen.size > 30000) this.seen.clear();
  }
}

// ---------- 商品行の共通整形 ----------
const HTML_TAG = /<[^>]*>/g;
export function cleanText(s, max = 200) {
  return String(s || "").replace(HTML_TAG, " ").replace(/\s+/g, " ").trim().slice(0, max);
}

// 表示用の商品名(販促の飾りを外す)。名寄せの判定には元の名前を使う
export function cleanName(s, max = 200) {
  return cleanText(s, 400)
    .replace(/【[^】]*】|［[^］]*］|\[[^\]]*\]|＼[^／]*／|★[^★]*★|◆[^◆]*◆/g, " ")
    .replace(/送料無料|あす楽|翌日配送|ポイント\s*\d+\s*倍|最大\d+%OFF|クーポン(配布|あり)?|楽天1位|公式(ショップ|ストア)?/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, max) || cleanText(s, max);
}

// 商品名・説明から「有名ブランド」と「悩みタグ」を付ける
export function enrich(row, { name, brandField, catchcopy, text }) {
  const b = matchBrand(name, brandField);
  if (b) {
    row.is_brand = true;
    if (!row.brand) row.brand = b;
  }
  const tags = detectPains({ name, catch: catchcopy, text });
  if (tags.length) row.tags = tags;
  return row;
}

export const isJan = (s) => typeof s === "string" && /^\d{8,13}$/.test(s) && !/^0+$/.test(s);

// 宿泊・ふるさと納税など、比較の対象にしない商品
export const NOISE = /ふるさと納税|宿泊|旅行券|チケット|商品券|ギフト券|中古|リユース|レンタル/;

// 楽天・Yahoo!の日時「2026-10-20 01:59」(JST)や UNIX秒 を ISO 形式に
export function jstToIso(s) {
  if (s == null || s === "") return null;
  if (typeof s === "number" || /^\d{9,11}$/.test(String(s))) {
    const n = Number(s);
    return n > 0 ? new Date(n * 1000).toISOString() : null;
  }
  const m = String(s).match(/^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})/);
  if (!m) return null;
  return `${m[1]}-${m[2]}-${m[3]}T${m[4]}:${m[5]}:00+09:00`;
}

// 検索用に商品名を短くする(先頭の主要な語だけ)
export function shortQuery(name, normalizeName) {
  const n = normalizeName(name || "");
  const toks = n.split(" ").filter((t) => t.length >= 2);
  let q = "";
  for (const t of toks) {
    if ((q + " " + t).trim().length > 40) break;
    q = (q + " " + t).trim();
    if (q.split(" ").length >= 6) break;
  }
  return q || n.slice(0, 40);
}

// 見つかった候補から「同じ商品」の中で一番安いものを選ぶ
export function pickSame(candidates, targetName, isSameProduct, { jan = null, threshold = 0.6 } = {}) {
  const tb = matchBrand(targetName, "");
  const ok = candidates.filter((c) => {
    if (!c || !(c.price > 0)) return false;
    if (jan && c.jan && c.jan === jan) return true;
    if (jan && c.jan && c.jan !== jan) return false;   // JANが違えば別商品
    // 両方にブランド名があって違うなら別商品(「ソニー用ケース」と「ソニー」の誤結合を防ぐ)
    const cb = matchBrand(c.name, "");
    if (tb && cb && tb !== cb) return false;
    return isSameProduct(c.name, targetName, jan ? 0.45 : threshold);
  });
  if (ok.length === 0) return null;
  // 極端に安いもの(付属品・お試しの紐付け)を除く
  const sorted = ok.map((c) => c.price).sort((a, b) => a - b);
  const med = sorted[Math.floor(sorted.length / 2)];
  const usable = ok.filter((c) => c.price >= med * 0.4);
  usable.sort((a, b) => a.price - b.price);
  return usable[0] || ok[0];
}
