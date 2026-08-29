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
const { adsFor, hasAds } = require('./ads');
const ogimage = require('./ogimage');

const PORT = process.env.PORT || 3000;
const TYPES = new Set(['album', 'manga', 'anime', 'movie', 'person', 'character', 'book']);

/* ------------------------------------------------------------------ *
 * キャッシュ（メモリ上・TTL付き・LRU）
 * 複数インスタンスで動かすなら Redis / KV に差し替える。
 * ------------------------------------------------------------------ */
const TTL = {
  search:  24 * 3600e3,       // 作品情報はほぼ変わらないので長めでよい
  suggest: 7 * 24 * 3600e3,   // 補完はさらに変わらない
  img:     7 * 24 * 3600e3,
};
const MAX_ENTRIES = 4000;
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

/** 許可ホストの画像をBufferで取得する（キャッシュ共用） */
async function getImageBuffer(target) {
  if (!imageAllowed(target)) return null;
  const key = 'img:' + target;
  const hit = cacheGet(key);
  if (hit) return hit.body;
  const upstream = await fetch(target, { headers: { 'User-Agent': 'MyNine/1.0' } });
  if (!upstream.ok) return null;
  const type = upstream.headers.get('content-type') || 'image/jpeg';
  if (!type.startsWith('image/')) return null;
  const body = Buffer.from(await upstream.arrayBuffer());
  if (body.length < 3_000_000) cacheSet(key, { body, type }, TTL.img);
  return body;
}

/** /img?u=... の形で保存されているURLから、元のURLを取り出す */
function originalURL(stored) {
  if (!stored) return '';
  if (stored.startsWith('/img?u=')) {
    try { return decodeURIComponent(stored.slice(7)); } catch { return ''; }
  }
  return stored;
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
               '.png': 'image/png', '.svg': 'image/svg+xml', '.ico': 'image/x-icon',
               '.webmanifest': 'application/manifest+json' };

function send(res, code, obj) {
  res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(obj));
}
/* Googleアナリティクス。GA_ID があるときだけHTMLに差し込む。
   4つのHTMLを個別に編集しなくて済み、IDもGitに載らない。 */
const GA_ID = process.env.GA_ID || '';

/* バリューコマースのLinkSwitch。VC_LINKSWITCH_ID を設定すると全ページに入る。
   ページ内のYahoo!ショッピングへの通常リンクが自動でアフィリエイト化される。 */
const VC_ID = process.env.VC_LINKSWITCH_ID || '';
const VC_TAG = VC_ID ? `
<script type="text/javascript" language="javascript">
  var vc_pid = "${VC_ID}";
</script>
<script type="text/javascript" src="//aml.valuecommerce.com/vcdal.js" async></script>` : '';
const GA_TAG = GA_ID ? `
<script async src="https://www.googletagmanager.com/gtag/js?id=${GA_ID}"></script>
<script>
  window.dataLayer = window.dataLayer || [];
  function gtag(){dataLayer.push(arguments);}
  gtag('js', new Date());
  gtag('config', '${GA_ID}');
</script>` : '';

function serveStatic(pathname, res) {
  const root = path.join(__dirname, 'public');
  const file = path.join(root, pathname === '/' ? 'index.html' : pathname.replace(/^\/+/, ''));
  if (!file.startsWith(root)) return send(res, 403, { error: 'forbidden' });
  fs.readFile(file, (err, buf) => {
    if (err) return send(res, 404, { error: 'not found' });
    const type = MIME[path.extname(file)] || 'application/octet-stream';
    if ((GA_TAG || VC_TAG) && type.startsWith('text/html')) {
      const html = buf.toString('utf8').replace('</head>', GA_TAG + VC_TAG + '\n</head>');
      res.writeHead(200, { 'Content-Type': type });
      return res.end(html);
    }
    res.writeHead(200, { 'Content-Type': type });
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
 * 共有ページのHTML
 * SNSのクローラーはJavaScriptを実行しないので、サーバー側で組み立てる。
 * ------------------------------------------------------------------ */
const KIND_LABEL = {
  album:'CD', manga:'漫画', book:'書籍', anime:'アニメ',
  movie:'映画', person:'有名人', character:'キャラクター',
};
const KIND_RATIO = {
  album:'1/1', manga:'460/654', book:'2/3', anime:'460/654',
  movie:'2/3', person:'3/4', character:'460/654',
};

const esc = t => String(t == null ? '' : t)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;');

function serveCard(card, res) {
  const base = process.env.CONTACT_URL || 'https://mynineloves.com';
  const title = card.title || '私を構成する9つ';
  const kind = KIND_LABEL[card.type] || '';
  const names = (card.items || []).map(i => i && i.title).filter(Boolean);
  const desc = names.length
    ? names.slice(0, 5).join(' ・ ') + (names.length > 5 ? ' ほか' : '')
    : `${kind}を9つ選んで1枚の画像にできます。`;
  const ogUrl = `${base}/og/${card.id}.png`;

  const cells = [];
  for (let i = 0; i < 9; i++) {
    const it = (card.items || []).find(v => v && v.position === i);
    const img = it && it.image_url
      ? `<img src="${esc(it.image_url)}" alt="${esc(it.title)}" loading="lazy">`
      : '';
    const cap = it && it.title
      ? `<span class="cap">${esc(it.title)}</span>` : '';
    cells.push(`<div class="cell">${img}${cap}</div>`);
  }

  const html = `<!DOCTYPE html>
<html lang="ja">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<link rel="icon" href="/favicon.svg" type="image/svg+xml">
<title>${esc(title)} | MY NINE LOVES</title>
<meta name="description" content="${esc(desc)}">
<meta property="og:type" content="website">
<meta property="og:site_name" content="MY NINE LOVES">
<meta property="og:title" content="${esc(title)}">
<meta property="og:description" content="${esc(desc)}">
<meta property="og:image" content="${esc(ogUrl)}">
<meta property="og:image:width" content="1200">
<meta property="og:image:height" content="630">
<meta property="og:url" content="${esc(base)}/c/${esc(card.id)}">
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:title" content="${esc(title)}">
<meta name="twitter:description" content="${esc(desc)}">
<meta name="twitter:image" content="${esc(ogUrl)}">
<style>
  :root{
    --ink:#EFF2E8;--panel:#FFF;--panel-2:#E4E9DA;--line:#C8D0BB;--text:#1B1F19;
    --muted:#5F6858;--obi:#FFC61A;--obi-deep:#E09600;--pop:#E03A5F;
    --head:#25302A;--head-text:#F2F6EC;--shadow:0 2px 0 rgba(200,208,187,.8);--r:12px;
    --mincho:"Hiragino Mincho ProN","Yu Mincho","Noto Serif JP",serif;
    --gothic:"Hiragino Sans","Yu Gothic","Noto Sans JP",system-ui,sans-serif;
    --mono:"SF Mono",ui-monospace,Menlo,Consolas,monospace;
  }
  *{box-sizing:border-box}
  body{margin:0;background:var(--ink);color:var(--text);font-family:var(--gothic);
    -webkit-font-smoothing:antialiased;padding-bottom:60px}
  @media (min-width:1024px){body{zoom:1.10}}
  a{color:var(--pop)}
  header{display:flex;background:var(--head);color:var(--head-text)}
  .obi-tab{background:var(--obi);color:#2A2622;font-family:var(--mono);font-size:11px;
    letter-spacing:.18em;padding:14px 10px;writing-mode:vertical-rl}
  .head-text{padding:18px 16px}
  .head-text h1{font-family:var(--mincho);font-weight:700;font-size:22px;margin:0 0 4px}
  .head-text p{margin:0;font-size:12px;color:#A9B6A2}
  .tabs{display:flex;background:var(--panel);border-bottom:1px solid var(--line);overflow-x:auto}
  .tab{padding:13px 18px;font-size:13px;color:var(--muted);text-decoration:none;white-space:nowrap}
  .tab:hover{color:var(--text);background:var(--panel-2)}
  main{max-width:560px;margin:0 auto;padding:26px 20px}
  .meta{display:flex;gap:14px;align-items:baseline;font-size:12px;color:var(--muted);
    margin-bottom:16px;flex-wrap:wrap}
  .meta .kind{color:var(--pop);font-weight:700}
  .grid{display:grid;grid-template-columns:repeat(3,1fr);gap:8px;margin-bottom:8px}
  .cell{position:relative;aspect-ratio:${KIND_RATIO[card.type] || '1/1'};
    background:var(--panel);border:1px solid var(--line);border-radius:var(--r);
    overflow:hidden;box-shadow:var(--shadow)}
  .cell img{width:100%;height:100%;object-fit:contain;display:block}
  .cell .cap{position:absolute;left:0;right:0;bottom:0;
    background:linear-gradient(transparent,rgba(0,0,0,.8));color:#fff;font-size:10px;
    padding:14px 5px 5px;overflow:hidden;white-space:nowrap;text-overflow:ellipsis}
  .note{font-size:11px;color:var(--muted);margin:14px 0 22px;line-height:1.8}
  .cta{display:block;text-align:center;background:var(--obi);color:#2A2622;font-weight:800;
    padding:16px;border-radius:var(--r);text-decoration:none;
    box-shadow:0 3px 0 var(--obi-deep);margin-bottom:10px}
  .sub{display:block;text-align:center;padding:13px;border:2px solid var(--line);
    border-radius:var(--r);text-decoration:none;color:var(--text);font-size:13px;
    background:var(--panel)}
  footer{max-width:560px;margin:32px auto 0;padding:18px 20px 0;
    border-top:1px solid var(--line);font-size:11px;color:var(--muted);line-height:1.9}
</style>
</head>
<body>
<header>
  <div class="obi-tab">MY NINE LOVES</div>
  <div class="head-text">
    <h1>${esc(title)}</h1>
    <p>${esc(kind)}を9つ選んだカード</p>
  </div>
</header>
<nav class="tabs">
  <a href="/" class="tab">つくる</a>
  <a href="/trends" class="tab">みんなの9つ</a>
  <a href="/about" class="tab">このサイトについて</a>
</nav>
<main>
  <div class="meta">
    <span class="kind">${esc(kind)}</span>
    ${card.handle ? `<a href="/u/${esc(card.handle)}">@${esc(card.handle)}</a>` : ''}
    <span>${Number(card.views) || 0} view ・ ${Number(card.likes) || 0} ♥</span>
  </div>
  <div class="grid">${cells.join('')}</div>
  <p class="note">
    自分で追加した画像は、この共有ページには表示されません（端末の中だけで処理され、
    サーバーには保存していないためです）。
  </p>
  <a class="cta" href="/">自分の9つをつくる</a>
  <a class="sub" href="/trends">みんなが選んだ9つを見る</a>
</main>
<footer>
  <p>
    <a href="/">トップ</a> ｜ <a href="/about">このサイトについて</a> ｜
    <a href="/terms">利用規約</a> ｜ <a href="/contact">お問い合わせ</a>
  </p>
  <p>&copy; 2026 MY NINE LOVES</p>
</footer>
</body>
</html>`;

  res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
  res.end(html);
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
          year:       Number(it.year) || null,
          imageUrl,
        };
      });

      // SNSハンドル（@なし・英数字と_のみ）。有名人ページの紐づけに使う
      const handle = String(body.handle || '').replace(/^@/, '').slice(0, 30);

      // 言語。指定が無ければブラウザの Accept-Language から推定する
      const accept = String(req.headers['accept-language'] || '');
      const lang = body.lang === 'en' || body.lang === 'ja'
        ? body.lang
        : (/^ja/i.test(accept) ? 'ja' : 'en');

      // 年齢ではなく生まれ年で保存する。こうすれば毎年の一斉更新が要らない
      const thisYear = new Date().getFullYear();
      const born = Number(body.born) || null;
      const bornOk = born && born >= thisYear - 100 && born <= thisYear - 5 ? born : null;
      const id = await store.save({
        type: body.type,
        title: String(body.title || '').slice(0, 60),
        name:  String(body.name || '').slice(0, 60),
        handle: /^[A-Za-z0-9_]{1,30}$/.test(handle) ? handle : null,
        lang, born: bornOk,
        items: clean, ipHash,
      });
      const shareable = clean.filter(x => x && x.imageUrl).length;
      const uploads   = clean.filter(x => x && !x.imageUrl).length;
      return send(res, 200, { id, shareable, uploads, stats: await store.stats() });
    }

    // 一覧（最新順・人気順・検索・SNSハンドル絞り込み）
    if (url.pathname === '/x/cards' && req.method === 'GET') {
      const type   = url.searchParams.get('type');
      const sort   = url.searchParams.get('sort') === 'hot' ? 'hot' : 'new';
      const handle = (url.searchParams.get('handle') || '').replace(/^@/, '').slice(0, 30) || null;
      const kw     = (url.searchParams.get('q') || '').slice(0, 40) || null;
      const limit  = Math.min(Number(url.searchParams.get('limit')) || 24, 48);
      const offset = Math.max(Number(url.searchParams.get('offset')) || 0, 0);
      if (type && !TYPES.has(type)) return send(res, 400, { error: '種別が不正です' });

      const items = await store.list({ type, sort, handle, q: kw, limit, offset });
      return send(res, 200, { items });
    }

    // 作品ランキング。言語・作品の年代・作った人の年齢層で絞れる
    if (url.pathname === '/x/top') {
      const type    = url.searchParams.get('type');
      const lang    = url.searchParams.get('lang');
      const decade  = Number(url.searchParams.get('decade')) || null;
      const ageBand = Number(url.searchParams.get('age')) || null;
      const limit   = Math.min(Number(url.searchParams.get('limit')) || 9, 30);
      if (type && !TYPES.has(type)) return send(res, 400, { error: '種別が不正です' });

      const key = `top:${type}:${lang}:${decade}:${ageBand}:${limit}`;
      const hit = cacheGet(key);
      if (hit) return send(res, 200, { items: hit, cached: true });

      const items = await store.top({
        type, limit,
        lang: lang === 'ja' || lang === 'en' ? lang : null,
        decade, ageBand,
      });
      cacheSet(key, items, 10 * 60e3);      // 10分キャッシュ
      return send(res, 200, { items });
    }

    // いいね（同じ人が連打できないよう、IP単位で1日1回まで）
    if (url.pathname === '/x/like' && req.method === 'POST') {
      const body = await readBody(req);
      const id = String(body.id || '').slice(0, 20);
      if (!id) return send(res, 400, { error: 'idが必要です' });

      const mark = `like:${hashIP(ip)}:${id}`;
      if (cacheGet(mark)) return send(res, 200, { likes: null, already: true });
      cacheSet(mark, true, 24 * 3600e3);

      const likes = await store.like(id);
      if (likes == null) return send(res, 404, { error: '見つかりません' });
      return send(res, 200, { likes });
    }

    // 種類ごとの広告。中身が無ければ空文字が返るだけ
    if (url.pathname === '/x/ads') {
      const kind = (url.searchParams.get('kind') || 'common').slice(0, 20);
      const alang = url.searchParams.get('lang') === 'en' ? 'en' : 'ja';
      res.writeHead(200, {
        'Content-Type': 'application/json; charset=utf-8',
        'Cache-Control': 'public, max-age=600',
      });
      return res.end(JSON.stringify(adsFor(kind, alang)));
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

      // 補完は打鍵のたびに飛んでくるので、IP単位でさらに絞る
      if (kind === 'suggest' && rateLimited('sg:' + ip, 40, 60e3)) {
        return send(res, 200, { items: [] });   // 静かに空を返す
      }
      const type = url.searchParams.get('type') || '';
      const q    = (url.searchParams.get('q') || '').trim();

      if (!TYPES.has(type)) return send(res, 400, { error: '種別が不正です' });
      if (!q)              return send(res, 400, { error: '検索語を入れてください' });
      if (q.length > 80)   return send(res, 400, { error: '検索語が長すぎます' });

      const lang = url.searchParams.get('lang') === 'en' ? 'en' : 'ja';
      const key = `${kind}:${type}:${lang}:${q.toLowerCase()}`;
      const hit = cacheGet(key);
      if (hit) return send(res, 200, { items: hit, cached: true });

      let items = kind === 'suggest' ? await P.suggest(type, q) : await P.search(type, q, lang);
      if (kind === 'search') items = items.map(it => ({ ...it, links: P.buyLinks(type, it) }));
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

      const items = (await P.works(type, id, { author }))
        .map(it => ({ ...it, links: P.buyLinks(type, it) }));
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

      const items = (await P.related(type, id))
        .map(it => ({ ...it, links: P.buyLinks(type, it) }));
      cacheSet(key, items, TTL.search);
      return send(res, 200, { items });
    }

    if (url.pathname === '/about') return serveStatic('/about.html', res);
    if (url.pathname === '/terms')  return serveStatic('/terms.html', res);
    if (url.pathname === '/trends')  return serveStatic('/trends.html', res);
    if (url.pathname === '/contact') return serveStatic('/contact.html', res);
    if (url.pathname === '/favicon.ico') return serveStatic('/favicon.svg', res);

    /* ---------- 共有ページ ----------
       /c/xxxxxxxx  … 9つを見せるページ（OGPタグ付き）
       /og/xxxxxxxx.png … SNSのサムネイル用画像
       アップロードされた画像は保存していないため、その枠は空欄で表示される。 */
    if (url.pathname.startsWith('/og/') && url.pathname.endsWith('.png')) {
      const id = url.pathname.slice(4, -4);
      if (!/^[\w-]{4,20}$/.test(id)) return send(res, 400, { error: 'idが不正です' });

      const key = 'og:' + id;
      const hit = cacheGet(key);
      if (hit) {
        res.writeHead(200, { 'Content-Type': 'image/png', 'Cache-Control': 'public, max-age=86400' });
        return res.end(hit);
      }
      const card = await store.get(id);
      if (!card) return send(res, 404, { error: 'not found' });

      const png = await ogimage.render(card, u => getImageBuffer(originalURL(u)));
      cacheSet(key, png, TTL.img);
      res.writeHead(200, { 'Content-Type': 'image/png', 'Cache-Control': 'public, max-age=86400' });
      return res.end(png);
    }

    if (url.pathname.startsWith('/c/')) {
      const id = url.pathname.slice(3).replace(/\/$/, '');
      if (!/^[\w-]{4,20}$/.test(id)) return serveStatic('/index.html', res);

      const card = await store.get(id);
      if (!card) {
        res.writeHead(404, { 'Content-Type': 'text/html; charset=utf-8' });
        return res.end('<meta charset="utf-8"><p>このページは見つかりませんでした。'
          + '<a href="/">トップへ</a></p>');
      }
      Promise.resolve(store.view(id)).catch(() => {});   // 閲覧数を数える
      return serveCard(card, res);
    }
    if (url.pathname === '/privacy-policy' || url.pathname === '/privacy')
      return serveStatic('/privacy.html', res);
    // /u/ユーザー名 で、その人が作ったものだけを見る
    if (url.pathname.startsWith('/u/')) return serveStatic('/trends.html', res);

    return serveStatic(url.pathname, res);
  } catch (err) {
    console.error(err.message);
    return send(res, err.status || 502, { error: err.message || '外部サービスとの通信に失敗しました' });
  }
});

// 0.0.0.0 で待ち受ける（Render や Fly.io など外部からの接続に必要）
/* ------------------------------------------------------------------ *
 * 定期的な掃除
 * 閲覧もいいねも0のまま指定日数を過ぎたものだけ消す。
 * 一度でも見られたカードは、共有リンクが生きている可能性があるため残す。
 * ------------------------------------------------------------------ */
const KEEP_DAYS = Number(process.env.KEEP_DAYS) || 90;

async function runCleanup() {
  try {
    const n = await store.cleanup(KEEP_DAYS);
    if (n) console.log(`掃除: 未閲覧のまま${KEEP_DAYS}日を過ぎた ${n} 件を削除しました`);
  } catch (e) {
    console.error('掃除に失敗:', e.message);
  }
}
setTimeout(runCleanup, 60e3);              // 起動1分後に一度
setInterval(runCleanup, 24 * 3600e3);      // 以後1日おき

server.listen(PORT, '0.0.0.0', () => {
  console.log(`MY NINE → http://localhost:${PORT}`);
  if (!P.hasTMDB()) console.log('※ TMDB_API_KEY が未設定のため、映画モードは無効です');
});
