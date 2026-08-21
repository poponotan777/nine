/**
 * MY NINE — サーバー（Node 18+ / 依存パッケージなし）
 *
 *   node server.js                          → http://localhost:3000
 *   TMDB_API_KEY=xxxx node server.js        → 映画モードも有効になる
 *
 * 役割:
 *   1. /api/search   種別ごとに外部APIを代理で叩く
 *   2. /api/suggest  入力補完（軽いエンドポイントのみを使う）
 *   3. /api/related  関連作品（シリーズ・続編・同アーティスト）
 *   4. /img          許可ホストの画像だけを同一オリジンで中継（canvas汚染の回避）
 */

const http = require('http');
const fs   = require('fs');
const path = require('path');
const P    = require('./providers');
const { store, hashIP } = require('./db');

const PORT = process.env.PORT || 3000;
const TYPES = new Set(['album', 'manga', 'anime', 'movie', 'person', 'character', 'book']);

/* ------------------------------------------------------------------ *
 * キャッシュ（メモリ上・TTL付き・LRU）
 * 複数インスタンスで動かすなら Redis / KV に差し替える。
 * ------------------------------------------------------------------ */
const TTL = { search: 6 * 3600e3, suggest: 24 * 3600e3, img: 24 * 3600e3 };
const MAX_ENTRIES = 1500;
const cache = new Map();

function cacheGet(key) {
  const hit = cache.get(key);
  if (!hit) return null;
  if (Date.now() > hit.expires) { cache.delete(key); return null; }
  cache.delete(key); cache.set(key, hit);
  return hit.value;
}
function cacheSet(key, value, ttl) {
  cache.set(key, { value, expires: Date.now() + ttl });
  while (cache.size > MAX_ENTRIES) cache.delete(cache.keys().next().value);
}

/* ------------------------------------------------------------------ *
 * かんたんなIP単位のレート制限
 * ------------------------------------------------------------------ */
const hits = new Map();
function rateLimited(ip, limit = 90, windowMs = 60e3) {
  const now = Date.now();
  const rec = hits.get(ip) || { n: 0, reset: now + windowMs };
  if (now > rec.reset) { rec.n = 0; rec.reset = now + windowMs; }
  rec.n++; hits.set(ip, rec);
  if (hits.size > 5000) hits.clear();
  return rec.n > limit;
}

/* ------------------------------------------------------------------ *
 * 画像プロキシ
 * ------------------------------------------------------------------ */
function imageAllowed(url) {
  try {
    const u = new URL(url);
    return u.protocol === 'https:' && P.IMG_HOSTS.some(re => re.test(u.hostname));
  } catch { return false; }
}

async function serveImage(target, res) {
  if (!imageAllowed(target)) return send(res, 400, { error: '許可されていない画像ホストです' });

  const key = 'img:' + target;
  const hit = cacheGet(key);
  if (hit) {
    res.writeHead(200, { 'Content-Type': hit.type, 'Cache-Control': 'public, max-age=86400', 'X-Cache': 'HIT' });
    return res.end(hit.body);
  }
  const upstream = await fetch(target, { headers: { 'User-Agent': 'MyNine/1.0' } });
  if (!upstream.ok) return send(res, 502, { error: '画像を取得できませんでした' });

  const type = upstream.headers.get('content-type') || 'image/jpeg';
  if (!type.startsWith('image/')) return send(res, 415, { error: '画像ではありません' });

  const body = Buffer.from(await upstream.arrayBuffer());
  if (body.length < 3_000_000) cacheSet(key, { body, type }, TTL.img);
  res.writeHead(200, { 'Content-Type': type, 'Cache-Control': 'public, max-age=86400', 'X-Cache': 'MISS' });
  res.end(body);
}

/* ------------------------------------------------------------------ *
 * 静的配信
 * ------------------------------------------------------------------ */
const MIME = { '.html': 'text/html; charset=utf-8', '.css': 'text/css', '.js': 'text/javascript',
               '.png': 'image/png', '.svg': 'image/svg+xml', '.ico': 'image/x-icon' };

function send(res, code, obj) {
  res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(obj));
}
function serveStatic(pathname, res) {
  const root = path.join(__dirname, 'public');
  const file = path.join(root, pathname === '/' ? 'index.html' : pathname.replace(/^\/+/, ''));
  if (!file.startsWith(root)) return send(res, 403, { error: 'forbidden' });
  fs.readFile(file, (err, buf) => {
    if (err) return send(res, 404, { error: 'not found' });
    res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream' });
    res.end(buf);
  });
}

function readBody(req, limit = 64 * 1024) {
  return new Promise((resolve, reject) => {
    let raw = '';
    req.on('data', c => {
      raw += c;
      if (raw.length > limit) { reject(new Error('リクエストが大きすぎます')); req.destroy(); }
    });
    req.on('end', () => {
      try { resolve(JSON.parse(raw || '{}')); }
      catch { reject(new Error('JSONを解析できません')); }
    });
    req.on('error', reject);
  });
}

/* ------------------------------------------------------------------ *
 * ルーティング
 * ------------------------------------------------------------------ */
const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const ip  = req.headers['x-forwarded-for']?.split(',')[0].trim() || req.socket.remoteAddress;

  try {
    if (url.pathname === '/img') return await serveImage(url.searchParams.get('u') || '', res);

    // 作成数カウンタ
    if (url.pathname === '/x/stats') {
      const s = await store.stats();
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
      return res.end(JSON.stringify(s));
    }

    // カードの保存（書き出し・共有したときに1件記録する）
    if (url.pathname === '/x/cards' && req.method === 'POST') {
      const ipHash = hashIP(ip);
      if (await store.countByIP(ipHash, 3600e3) > 40) {
        return send(res, 429, { error: '短時間に作りすぎです。少し待ってください。' });
      }
      const body = await readBody(req);
      if (!TYPES.has(body.type)) return send(res, 400, { error: '種別が不正です' });

      const items = Array.isArray(body.items) ? body.items.slice(0, 9) : [];
      if (!items.filter(Boolean).length) return send(res, 400, { error: '中身がありません' });

      // アップロード画像はサーバーに保存しない。共有ページにも出さない。
      // API由来のものだけ、画像の「URL」を控える（画像そのものは持たない）
      const clean = items.map(it => {
        if (!it) return null;
        const source = String(it.source || '').slice(0, 20) || null;
        const fromAPI = source && source !== 'upload';
        const imageUrl = fromAPI && typeof it.imageUrl === 'string' && imageAllowed(it.imageUrl)
          ? it.imageUrl.slice(0, 500)
          : null;
        return {
          source,
          externalId: fromAPI && it.externalId != null ? String(it.externalId).slice(0, 40) : null,
          title:      String(it.title || '').slice(0, 120),
          sub:        String(it.sub || '').slice(0, 120),
          imageUrl,
        };
      });

      const id = await store.save({
        type: body.type,
        title: String(body.title || '').slice(0, 60),
        name:  String(body.name || '').slice(0, 60),
        items: clean, ipHash,
      });
      const shareable = clean.filter(x => x && x.imageUrl).length;
      const uploads   = clean.filter(x => x && !x.imageUrl).length;
      return send(res, 200, { id, shareable, uploads, stats: await store.stats() });
    }

    if (url.pathname === '/x/config') {
      return send(res, 200, {
        movieEnabled: P.hasTMDB(),
        youtubeEnabled: P.hasYouTube(),
        bookEnabled: P.hasRakuten(),
      });
    }

    if (url.pathname.startsWith('/x/')) {
      if (rateLimited(ip)) return send(res, 429, { error: 'リクエストが多すぎます。少し待ってください。' });
    }

    if (url.pathname === '/x/search' || url.pathname === '/x/suggest') {
      const kind = url.pathname.endsWith('suggest') ? 'suggest' : 'search';
      const type = url.searchParams.get('type') || '';
      const q    = (url.searchParams.get('q') || '').trim();

      if (!TYPES.has(type)) return send(res, 400, { error: '種別が不正です' });
      if (!q)              return send(res, 400, { error: '検索語を入れてください' });
      if (q.length > 80)   return send(res, 400, { error: '検索語が長すぎます' });

      const key = `${kind}:${type}:${q.toLowerCase()}`;
      const hit = cacheGet(key);
      if (hit) return send(res, 200, { items: hit, cached: true });

      const items = kind === 'suggest' ? await P.suggest(type, q) : await P.search(type, q);
      cacheSet(key, items, TTL[kind]);
      return send(res, 200, { items });
    }

    if (url.pathname === '/x/creators') {
      const type = url.searchParams.get('type') || '';
      const qs   = (url.searchParams.get('q') || '').trim();
      if (!TYPES.has(type)) return send(res, 400, { error: '種別が不正です' });
      if (!qs)              return send(res, 400, { error: '名前を入れてください' });
      if (qs.length > 80)   return send(res, 400, { error: '検索語が長すぎます' });

      const key = `creators:${type}:${qs.toLowerCase()}`;
      const hit = cacheGet(key);
      if (hit) return send(res, 200, { items: hit, cached: true });

      const items = await P.creators(type, qs);
      cacheSet(key, items, TTL.search);
      return send(res, 200, { items });
    }

    if (url.pathname === '/x/works') {
      const type   = url.searchParams.get('type') || '';
      const id     = url.searchParams.get('id') || '';
      const author = (url.searchParams.get('author') || '').slice(0, 60);
      if (!TYPES.has(type)) return send(res, 400, { error: '種別が不正です' });
      if (type !== 'book' && !/^\d+$/.test(id)) return send(res, 400, { error: 'idが不正です' });
      if (type === 'book' && !author) return send(res, 400, { error: '著者名が必要です' });

      const key = `works:${type}:${id}:${author}`;
      const hit = cacheGet(key);
      if (hit) return send(res, 200, { items: hit, cached: true });

      const items = await P.works(type, id, { author });
      cacheSet(key, items, TTL.search);
      return send(res, 200, { items });
    }

    if (url.pathname === '/x/related') {
      const type = url.searchParams.get('type') || '';
      const id   = url.searchParams.get('id') || '';
      if (!TYPES.has(type))   return send(res, 400, { error: '種別が不正です' });
      if (!/^\d+$/.test(id))  return send(res, 400, { error: 'idが不正です' });

      const key = `related:${type}:${id}`;
      const hit = cacheGet(key);
      if (hit) return send(res, 200, { items: hit, cached: true });

      const items = await P.related(type, id);
      cacheSet(key, items, TTL.search);
      return send(res, 200, { items });
    }

    if (url.pathname === '/about') return serveStatic('/about.html', res);
    if (url.pathname === '/terms') return serveStatic('/terms.html', res);

    return serveStatic(url.pathname, res);
  } catch (err) {
    console.error(err.message);
    return send(res, err.status || 502, { error: err.message || '外部サービスとの通信に失敗しました' });
  }
});

// 0.0.0.0 で待ち受ける（Render や Fly.io など外部からの接続に必要）
server.listen(PORT, '0.0.0.0', () => {
  console.log(`MY NINE → http://localhost:${PORT}`);
  if (!P.hasTMDB()) console.log('※ TMDB_API_KEY が未設定のため、映画モードは無効です');
});
