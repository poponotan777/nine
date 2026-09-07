/**
 * MY NINE — サーバー（Node 22.5 以上）
 *
 *   npm install                             → pg と @napi-rs/canvas が入る
 *   node server.js                          → http://localhost:3000
 *   TMDB_API_KEY=xxxx node server.js        → 映画モードも有効になる
 *
 * ------------------------------------------------------------------
 * APIのパスは必ず /x/ で始める。/api/ は使ってはいけない。
 *
 * Render が /api/ を予約パスとして横取りするため、
 * /api/* にすると本番だけ全部404になる（ローカルでは再現しない）。
 * 過去に実際に踏んでいる。戻さないこと。
 * ------------------------------------------------------------------
 *
 * 役割:
 *   1. /x/search    種別ごとに外部APIを代理で叩く
 *   2. /x/suggest   入力補完（軽いエンドポイントのみを使う）
 *   3. /x/related   関連作品（シリーズ・続編・同アーティスト）
 *   4. /x/cards     カードの保存と一覧。9つ揃っていないものは受け付けない
 *   5. /x/top       作品ランキング（item_stats から読む）
 *   6. /x/like      いいね（端末ごとに1カード1回）
 *   7. /img         許可ホストの画像だけを同一オリジンで中継（canvas汚染の回避）
 *   8. /c/:id       共有ページ。OGPタグ入りのHTMLをここで組み立てる
 *   9. /og/:id.png  共有用のサムネイル（1200×630）
 *  10. /healthz     死活監視用。DBには触れない
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
 * 画像だけは別のキャッシュに分ける
 *
 * 以前は本文の結果と同じMapに入れていたが、件数（4000）でしか制限して
 * いなかったため、表紙やOGP画像が並ぶとメモリを使い切って落ちていた。
 * ここでは合計バイト数で上限をかける。既定64MB、IMG_CACHE_MB で変えられる。
 * ------------------------------------------------------------------ */
const IMG_BUDGET = Number(process.env.IMG_CACHE_MB || 64) * 1024 * 1024;
const imgCache = new Map();
let imgBytes = 0;

function imgCacheGet(key) {
  const hit = imgCache.get(key);
  if (!hit) return null;
  if (Date.now() > hit.expires) { imgCache.delete(key); imgBytes -= hit.size; return null; }
  imgCache.delete(key); imgCache.set(key, hit);      // 使ったものを新しい側へ
  return hit.value;
}
function imgCacheSet(key, value, ttl) {
  const size = value?.body?.length || value?.length || 0;
  if (!size || size > IMG_BUDGET / 8) return;        // 極端に大きいものは載せない
  const old = imgCache.get(key);
  if (old) imgBytes -= old.size;
  imgCache.set(key, { value, expires: Date.now() + ttl, size });
  imgBytes += size;
  // 上限を超えたら、古いものから捨てる
  while (imgBytes > IMG_BUDGET && imgCache.size) {
    const k = imgCache.keys().next().value;
    imgBytes -= imgCache.get(k).size;
    imgCache.delete(k);
  }
}

/* ------------------------------------------------------------------ *
 * 検索結果は保存先（PostgreSQL等）にも置く
 *
 * メモリだけだと、再起動のたびに空になる。無料枠は再デプロイもOOMも
 * 起きやすく、アクセスが集中している最中ほどキャッシュが消える。
 * 手前をメモリ、奥をDBの2段にして、外部APIを叩く回数を減らす。
 * ------------------------------------------------------------------ */
/* 期限が切れても、すぐには捨てない。
   古い内容をそのまま返し、裏で取り直す（stale-while-revalidate）。

   作品名や表紙は1日古くても実害がない一方、外部APIの応答を待たせると
   混雑時に行列ができる。「返すのは即座、更新は後回し」にすることで、
   利用者を待たせず、送信キューも詰まらせずに済む。

   保存は ttl × GRACE の長さで行い、「本来の期限」は値の中に持たせる。
   こうするとdb.js側は素朴な期限付きKVのままでよい。 */
const STALE_GRACE = 6;                 // 期限の6倍までは古い内容を使う
const refreshing = new Set();          // 裏で取り直し中のキー
const MAX_REFRESH = 20;                // 同時に走らせる上限

async function cacheGet2(key) {
  let box = cacheGet(key);
  if (!box && store && typeof store.cacheGet === 'function') {
    try {
      // 同時に来た人が全員DBに聞きに行かないよう、これも1本にまとめる
      box = await once('kv:' + key, () => store.cacheGet(key));
      if (box) cacheSet(key, box, 10 * 60e3);   // 手前にも短く置く
    } catch { box = null; }
  }
  if (!box) return null;
  // 古い形式（包んでいないもの）が残っていても壊れないようにする
  if (!box || typeof box !== 'object' || !('v' in box)) return { value: box, stale: false };
  return { value: box.v, stale: Date.now() > box.soft };
}

function cacheSet2(key, value, ttl) {
  const box = { v: value, soft: Date.now() + ttl };
  cacheSet(key, box, Math.min(ttl * STALE_GRACE, 24 * 3600e3));
  // 空の結果はDBに残さない。書き込むたびにDBを起こすうえ、
  // 取り直しても安いので、保存容量とCU時間の両方の無駄になる
  if (Array.isArray(value) && !value.length) return;
  if (store && typeof store.cacheSet === 'function') {
    Promise.resolve(store.cacheSet(key, box, ttl * STALE_GRACE)).catch(() => {});
  }
}

/* ------------------------------------------------------------------ *
 * 同じ語の取得は1本にまとめる（single-flight）
 *
 * キャッシュが無い状態で同じ語を30人が同時に検索すると、全員が
 * 「キャッシュに無い」と判断してから、それぞれ外部APIを叩いていた。
 * 1回で済むものが30回になる。拡散した瞬間はこれが千単位で起きる。
 *
 * 取得中のキーを覚えておき、後から来た人には同じ約束（Promise）を
 * 返すことで、外部への問い合わせを1回に抑える。
 * ------------------------------------------------------------------ */
const inFlight = new Map();

function once(key, fetcher) {
  const running = inFlight.get(key);
  if (running) return running;
  const p = Promise.resolve()
    .then(fetcher)
    .finally(() => inFlight.delete(key));
  p.catch(() => {});   // 待ち手が付く前に失敗しても落とさない
  inFlight.set(key, p);
  return p;
}

/** 古い内容を返したあと、裏で取り直す。失敗しても古いものが残るだけ */
function refreshLater(key, ttl, fetcher) {
  if (refreshing.has(key) || refreshing.size >= MAX_REFRESH) return;
  refreshing.add(key);
  Promise.resolve()
    .then(fetcher)
    .then(() => {})   // 保存は fetcher の中で済ませている
    .catch(() => {})
    .finally(() => refreshing.delete(key));
}

/* いいねの重複防止（手前のメモリ）。
   本体の記録は保存先の kv に残しているので、ここは速さのための写しにすぎない。
   増えすぎたときだけ古いものから捨てる。消えても kv を見に行くので二重にはならない。 */
const likedMark = new Map();
setInterval(() => {
  if (likedMark.size <= 50000) return;
  const drop = likedMark.size - 40000;
  let i = 0;
  for (const k of likedMark.keys()) { likedMark.delete(k); if (++i >= drop) break; }
}, 3600e3).unref?.();

/** 保存直後にOGP画像を作って、キャッシュに載せておく。
    クローラーが来たときには出来上がっている状態にする。 */
function warmOgImage(id, card) {
  setTimeout(() => {
    once('ogrender:' + id, async () => {
      // 保存直後は中身が手元にあるので、DBに引き直さない
      if (!card) card = await store.get(id);
      if (!card) return null;
      const png = await ogimage.render(card, u => getImageBuffer(originalURL(u)));
      if (png) imgCacheSet('og:' + id, png, TTL.img);
      return png;
    }).catch(() => { /* 失敗しても、貼られた時点で作り直される */ });
  }, 50);
}

/* ------------------------------------------------------------------ *
 * 閲覧数はまとめて書く
 *
 * 共有ページが拡散すると「1表示 = 1回のUPDATE」になり、DBが休む間もなく
 * 起き続ける。Neonの無料枠は稼働時間で数えるため、これが効いてくる。
 * 数分ぶんをメモリに溜めてから、1回のUPDATEにまとめる。
 * 落ちたときは溜まっていたぶんだけ失われるが、閲覧数なので影響は小さい。
 * ------------------------------------------------------------------ */
const pendingViews = new Map();

function countView(id) {
  pendingViews.set(id, (pendingViews.get(id) || 0) + 1);
}

async function flushViews() {
  if (!pendingViews.size) return;
  const batch = [...pendingViews];
  pendingViews.clear();
  for (const [id, n] of batch) {
    try { await store.view(id, n); } catch { /* 次の機会に数え直さない */ }
  }
}
setInterval(flushViews, 3 * 60e3).unref?.();
process.on('SIGTERM', () => { flushViews().finally(() => process.exit(0)); });

/* ------------------------------------------------------------------ *
 * かんたんなIP単位のレート制限
 * ------------------------------------------------------------------ */
const hits = new Map();

/* 日本のスマホ回線は、多数の利用者が同じIPを共有する（CGNAT）。
   IPだけで厳しく数えると、拡散したときに無関係の人がまとめて弾かれる。
   そこで全体の上限は緩くし、外部APIを実際に叩くときだけ別枠で数える。 */
const REQ_PER_MIN      = Number(process.env.RATE_PER_MIN || 600);      // ページや画像を含む全体
const UPSTREAM_PER_MIN = Number(process.env.UPSTREAM_PER_MIN || 120);  // 外部APIを叩く分だけ

function rateLimited(ip, limit = REQ_PER_MIN, windowMs = 60e3) {
  const now = Date.now();
  const rec = hits.get(ip) || { n: 0, reset: now + windowMs };
  if (now > rec.reset) { rec.n = 0; rec.reset = now + windowMs; }
  rec.n++; hits.set(ip, rec);
  // 古いものから捨てる。全消しにすると、その瞬間だけ制限が消えてしまう
  if (hits.size > 20000) {
    for (const [k, v] of hits) { if (now > v.reset) hits.delete(k); if (hits.size <= 10000) break; }
  }
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
  const hit = imgCacheGet(key);
  if (hit) return hit.body;
  const got = await fetchImageOnce(target);
  return got ? got.body : null;
}

/* 同じ画像を同時に何人が求めても、取りに行くのは1回だけにする。
   表紙は9マス分がまとめて表示されるうえ、拡散すると同じ表紙に
   一斉にアクセスが来るため、ここを重複させると帯域もメモリも無駄になる。 */
function fetchImageOnce(target) {
  return once('imgfetch:' + target, async () => {
    const upstream = await fetch(target, { headers: { 'User-Agent': 'MyNine/1.0' } });
    if (!upstream.ok) return null;
    const type = upstream.headers.get('content-type') || 'image/jpeg';
    if (!type.startsWith('image/')) return null;
    const body = Buffer.from(await upstream.arrayBuffer());
    if (body.length < 3_000_000) imgCacheSet('img:' + target, { body, type }, TTL.img);
    return { body, type };
  });
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
  const hit = imgCacheGet(key);
  if (hit) {
    res.writeHead(200, { 'Content-Type': hit.type, 'Cache-Control': 'public, max-age=86400', 'X-Cache': 'HIT' });
    return res.end(hit.body);
  }
  const got = await fetchImageOnce(target);
  if (!got) return send(res, 502, { error: '画像を取得できませんでした' });

  res.writeHead(200, { 'Content-Type': got.type, 'Cache-Control': 'public, max-age=86400', 'X-Cache': 'MISS' });
  res.end(got.body);
}

/* ------------------------------------------------------------------ *
 * 静的配信
 * ------------------------------------------------------------------ */
const MIME = { '.html': 'text/html; charset=utf-8', '.css': 'text/css', '.js': 'text/javascript',
               '.png': 'image/png', '.svg': 'image/svg+xml', '.ico': 'image/x-icon',
               '.webmanifest': 'application/manifest+json',
               // robots.txt と sitemap.xml。未登録だと octet-stream で返り、
               // 検索エンジンに正しく読まれない
               '.txt': 'text/plain; charset=utf-8', '.xml': 'application/xml; charset=utf-8' };

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

/* 静的ファイルは組み立て済みのものを保つ。
   index.html は82KBあり、毎回ディスクから読んでGAタグを差し込み直すのは
   アクセス数にそのまま比例する無駄になる。中身はデプロイまで変わらない。 */
const staticCache = new Map();

function serveStatic(pathname, res) {
  const root = path.join(__dirname, 'public');
  const file = path.join(root, pathname === '/' ? 'index.html' : pathname.replace(/^\/+/, ''));
  if (!file.startsWith(root)) return send(res, 403, { error: 'forbidden' });

  const ready = staticCache.get(file);
  if (ready) {
    res.writeHead(200, { 'Content-Type': ready.type });
    return res.end(ready.buf);
  }

  fs.readFile(file, (err, buf) => {
    if (err) return send(res, 404, { error: 'not found' });
    const type = MIME[path.extname(file)] || 'application/octet-stream';
    let out = buf;
    if ((GA_TAG || VC_TAG) && type.startsWith('text/html')) {
      out = Buffer.from(buf.toString('utf8').replace('</head>', GA_TAG + VC_TAG + '\n</head>'), 'utf8');
    }
    // 画像やフォントまで抱えるとメモリを食うので、テキストだけ保つ
    if (out.length < 512 * 1024 && staticCache.size < 40) {
      staticCache.set(file, { buf: out, type });
    }
    res.writeHead(200, { 'Content-Type': type });
    res.end(out);
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
  // SNSは og:title を画像に重ねて表示する。長いと画像が隠れるので詰める。
  const rawTitle = card.title || '私を構成する9つ';
  const title = rawTitle.length > 28 ? rawTitle.slice(0, 27) + '…' : rawTitle;
  const kind = KIND_LABEL[card.type] || '';
  const names = (card.items || []).map(i => i && i.title).filter(Boolean);
  const desc = names.length
    ? names.slice(0, 5).join(' ・ ') + (names.length > 5 ? ' ほか' : '')
    : `${kind}を9つ選んで1枚の画像にできます。`;
  const ogUrl = `${base}/og/${card.id}.png`;

  const cells = [];
  const details = [];
  for (let i = 0; i < 9; i++) {
    const it = (card.items || []).find(v => v && v.position === i);
    if (!it) { cells.push('<div class="cell"></div>'); continue; }

    const img = it.image_url
      ? `<img src="${esc(it.image_url)}" alt="${esc(it.title)}" loading="lazy">`
      : '';
    const cap = it.title ? `<span class="cap">${esc(it.title)}</span>` : '';
    // タップで下の詳細へ移動する
    cells.push(`<a class="cell" href="#i${i}" data-i="${i}">${img}${cap}</a>`);

    // 詳細（作品名・作者・購入先）
    const links = P.buyLinks(card.type, {
      title: it.title, buyUrl: it.buy_url || '', year: it.year,
    }) || [];
    const linkHtml = links.length
      ? `<div class="buys"><span class="pr">PR（アフィリエイトリンク）</span>`
        + links.map(l => `<a href="${esc(l.url)}" target="_blank"
            rel="noopener sponsored nofollow">${esc(l.label)}</a>`).join('')
        + `</div>`
      : '';
    details.push(`<div class="detail" id="i${i}">
      <div class="d-head">
        ${it.image_url ? `<img src="${esc(it.image_url)}" alt="" loading="lazy">` : ''}
        <div>
          <div class="d-title">${esc(it.title)}</div>
          ${it.sub ? `<div class="d-sub">${esc(it.sub)}</div>` : ''}
        </div>
      </div>
      ${linkHtml}
    </div>`);
  }

  /* 共有ページの広告。
     ADSENSE_JSON / ADS_JSON のキーは 'share' で引ける（share_rail など）。
     ページ名を書かずに 'rail' だけ設定してあれば、それがそのまま使われる。
     ここはサーバー側でHTMLに直接書き出すので、画面側の runAdScripts は通らない。
     ブラウザが最初に読むHTMLに <script> が入っている形なので、普通に実行される。 */
  const shareAds = adsFor('share', card.lang === 'en' ? 'en' : 'ja');

  /* アドセンスのコードは枠ごとに読み込みスクリプトを含むが、
     1ページに何本も入れる必要はない（Googleも1本を想定している）。
     2本目以降は落とす。画面側の runAdScripts と同じ考え方だが、
     こちらはHTMLを組み立てる時点で消す。 */
  const seenSrc = new Set();
  const dedupeLoader = (s) => (s || '').replace(
    /<script[^>]*\ssrc=['"]([^'"]*adsbygoogle\.js[^'"]*)['"][^>]*><\/script>/g,
    (m, src) => (seenSrc.has(src) ? '' : (seenSrc.add(src), m))
  );
  shareAds.rail     = dedupeLoader(shareAds.rail);
  shareAds.railLeft = dedupeLoader(shareAds.railLeft);
  shareAds.bar      = dedupeLoader(shareAds.bar);

  const railHtml = (inner, side) => inner
    ? `<aside class="rail rail-${side}" aria-label="広告"><div class="slot-ad">${inner}</div></aside>`
    : '';
  const barHtml = shareAds.bar
    ? `<div class="adbar" id="adBar">
  <button class="adbar-close" id="adBarClose" aria-label="広告を閉じる">×</button>
  <div class="adbar-slot">${shareAds.bar}</div>
</div>`
    : '';

  const html = `<!DOCTYPE html>
<html lang="ja">
<head>
<meta charset="utf-8">
<!-- このページは「みんなの9つ」の詳細から iframe で読み込まれる。
     base が無いと、ナビもフッターも枠の中で開いてしまい、外に出られない。
     _top にすると、iframe の外（親のウィンドウ）で開く。
     単体で開いたときは _self と同じ動きなので、実害は無い。 -->
<base target="_top">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<meta name="google-adsense-account" content="ca-pub-7335055001091712">
<!-- 丸ゴシック。つくるページと同じ見た目にするため。
     display=swap なので、読み込み前でも文字は消えない。 -->
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=M+PLUS+Rounded+1c:wght@400;500;700;800&display=swap" rel="stylesheet">
<link rel="icon" href="/icon-32.png" sizes="32x32">
<link rel="apple-touch-icon" href="/icon-180.png">
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
    --mincho:"M PLUS Rounded 1c","Hiragino Maru Gothic ProN","ヒラギノ丸ゴ ProN","Yu Gothic","Noto Sans JP",sans-serif;
    --gothic:"Hiragino Maru Gothic ProN","ヒラギノ丸ゴ ProN","Hiragino Sans","Yu Gothic Medium","Yu Gothic","Meiryo","Noto Sans JP",system-ui,sans-serif;
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
  .meta{display:flex;gap:14px;align-items:center;font-size:12px;color:var(--muted);
    margin-bottom:16px;flex-wrap:wrap}
  .meta .kind{color:var(--pop);font-weight:700}
  /* Xへのリンク。サイト内の /u/ と並ぶので、外に出ることが分かるように囲む */
  .meta .xlink{border:1px solid var(--line);border-radius:999px;
    padding:3px 10px;font-size:11px;text-decoration:none}
  .grid{display:grid;grid-template-columns:repeat(3,1fr);gap:8px;margin-bottom:8px}
  .cell{position:relative;aspect-ratio:${KIND_RATIO[card.type] || '1/1'};
    background:var(--panel);border:1px solid var(--line);border-radius:var(--r);
    overflow:hidden;box-shadow:var(--shadow)}
  .cell img{width:100%;height:100%;object-fit:contain;display:block}
  .cell .cap{position:absolute;left:0;right:0;bottom:0;
    background:linear-gradient(transparent,rgba(0,0,0,.8));color:#fff;font-size:10px;
    padding:14px 5px 5px;overflow:hidden;white-space:nowrap;text-overflow:ellipsis}
  .note{font-size:11px;color:var(--muted);margin:14px 0 22px;line-height:1.8}
  .tap-hint{font-size:11px;color:var(--muted);margin:10px 0 18px}
  .details{display:flex;flex-direction:column;gap:10px;margin-bottom:22px}
  .detail{background:var(--panel);border:1px solid var(--line);border-radius:var(--r);
    padding:14px 16px;box-shadow:var(--shadow);scroll-margin-top:20px}
  .detail:target{border-color:var(--obi-deep);box-shadow:0 0 0 3px rgba(255,198,26,.35)}
  .d-head{display:flex;gap:12px;align-items:center;margin-bottom:10px}
  .d-head img{width:52px;height:70px;object-fit:contain;background:var(--panel-2);
    border-radius:4px;flex:0 0 auto}
  .d-title{font-size:15px;font-weight:700;line-height:1.4}
  .d-sub{font-size:12px;color:var(--muted);margin-top:3px}
  .buys .pr{display:block;font-family:var(--mono);font-size:9px;letter-spacing:.16em;
    color:var(--muted);margin-bottom:6px}
  .buys a{display:block;text-align:center;padding:10px;margin-bottom:5px;
    border:1px solid var(--line);border-radius:var(--r);color:var(--muted);
    font-size:13px;text-decoration:none}
  .buys a:hover{border-color:var(--pop);color:var(--pop);background:#FCEFF2}
  a.cell{display:block;text-decoration:none}
  .cta{display:block;text-align:center;background:var(--obi);color:#2A2622;font-weight:800;
    padding:16px;border-radius:var(--r);text-decoration:none;
    box-shadow:0 3px 0 var(--obi-deep);margin-bottom:10px}
  .sub{display:block;text-align:center;padding:13px;border:2px solid var(--line);
    border-radius:var(--r);text-decoration:none;color:var(--text);font-size:13px;
    background:var(--panel)}
  footer{max-width:560px;margin:32px auto 0;padding:18px 20px 0;
    border-top:1px solid var(--line);font-size:11px;color:var(--muted);line-height:1.9}

  /* ---- 広告 ----
     この共有ページはSNSからの着地点で、いちばん人が来る。
     ただし body に zoom が掛かるため、Chromium では position:sticky が
     内側で正しく動かない（index.html と同じ制約）。
     このページは縦に短いので追従はさせず、置いたままにする。

     閾値の計算は index.html と同じ:
       画面幅 >= 2×(オフセット+レール幅)×zoom
       2×(300+160)×1.10 = 1012px → 余裕を見て1100px */
  .rail{display:none}
  @media (min-width:1100px){
    .rail{
      display:block;position:absolute;top:var(--rail-start,320px);width:160px;
      font-size:9px;color:var(--muted);text-align:center;font-family:var(--mono);
    }
    .rail-l{right:calc(50% + 300px)}
    .rail-r{left:calc(50% + 300px)}
    .rail .slot-ad::before{
      content:'PR';display:block;font-family:var(--mono);font-size:9px;
      letter-spacing:.2em;color:var(--muted);margin-bottom:6px;
    }
    .rail .slot-ad:empty{display:none}
    .rail img{max-width:100%;width:auto;height:auto;display:block;margin:0 auto}
  }
  /* スマホ用の下部バー。固定表示だが操作は覆わない */
  .adbar{
    position:fixed;left:0;right:0;bottom:0;z-index:40;
    background:var(--panel);border-top:1px solid var(--line);
    padding:6px 34px 6px 8px;display:flex;justify-content:center;align-items:center;
    min-height:56px;
  }
  .adbar-close{
    position:absolute;right:6px;top:50%;transform:translateY(-50%);
    width:26px;height:26px;border-radius:50%;border:1px solid var(--line);
    background:var(--ink);color:var(--muted);font-size:14px;line-height:1;cursor:pointer;
  }
  .adbar-slot{min-height:50px;display:flex;align-items:center}
  /* hidden 属性だけでは display:flex に負けて閉じない。明示的に打ち消す */
  .adbar[hidden]{display:none}
  @media (min-width:1200px){ .adbar{display:none} }
  body.has-adbar{padding-bottom:150px}
</style>
${GA_TAG}${VC_TAG}
</head>
<body${shareAds.bar ? ' class="has-adbar"' : ''}>
${railHtml(shareAds.rail, 'r')}${railHtml(shareAds.railLeft, 'l')}
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
    ${card.handle ? `<a href="/u/${esc(card.handle)}">@${esc(card.handle)}</a>
    <a class="xlink" href="https://x.com/${esc(card.handle)}" target="_blank" rel="noopener">Xで見る</a>` : ''}
    <span>${Number(card.views) || 0} view ・ ${Number(card.likes) || 0} ♥</span>
  </div>
  <div class="grid">${cells.join('')}</div>
  <p class="tap-hint">作品をタップすると、くわしい情報と購入先が見られます。</p>
  <div class="details">${details.join('')}</div>
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
${barHtml}${shareAds.bar ? `<script>
  /* 下部バーを閉じたら、その日のあいだは出さない。
     つくるページと同じキーを使うので、片方で閉じればもう片方でも閉じたまま。 */
  (function(){
    var KEY = 'adbar_closed', bar = document.getElementById('adBar');
    if (!bar) return;
    var today = new Date().toISOString().slice(0, 10);
    try { if (localStorage.getItem(KEY) === today){
      bar.hidden = true; document.body.classList.remove('has-adbar'); return;
    } } catch(e){}
    document.getElementById('adBarClose').addEventListener('click', function(){
      bar.hidden = true;
      document.body.classList.remove('has-adbar');
      try { localStorage.setItem(KEY, today); } catch(e){}
    });
  })();
</script>` : ''}
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
  // Cloudflareを前段に置いた場合は CF-Connecting-IP が本当の接続元になる
  const ip  = req.headers['cf-connecting-ip']
           || req.headers['x-forwarded-for']?.split(',')[0].trim()
           || req.socket.remoteAddress;

  try {
    /* 死活監視（UptimeRobot等）用。
       目的はRenderをスリープさせないことだけなので、DBには一切触れない。
       トップや /about を叩くと、そのたびにNeonのコンピュートが起きてしまい、
       無料枠のCU時間（月100＝1日あたり約13時間）を昼夜問わず消費する。
       応答も2バイトなので、5分間隔で叩いても帯域をほぼ使わない。 */
    if (url.pathname === '/healthz') {
      res.writeHead(200, { 'Content-Type': 'text/plain', 'Cache-Control': 'no-store' });
      return res.end('ok');
    }

    if (url.pathname === '/img') return await serveImage(url.searchParams.get('u') || '', res);

    // 作成数カウンタ
    if (url.pathname === '/x/stats') {
      // トップを開くたびに走るので、30秒だけ持つ。
      // 作成数は多少遅れて増えても困らない一方、
      // 素通しにするとアクセス数がそのままDBの稼働時間になる。
      let s = cacheGet('stats');
      if (!s) {
        s = await once('stats', () => store.stats());
        cacheSet('stats', s, 30e3);
      }
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

      /* 9つ揃っていないものは受け付けない。
         画面側でもボタンを無効にしているが、そこだけだと
         /x/cards に直接POSTすれば虫食いのカードを保存できてしまう。
         item_stats は積み上げなので、一度混ざった数字は取り消せない。 */
      const items = Array.isArray(body.items) ? body.items.slice(0, 9) : [];
      if (items.filter(Boolean).length !== 9) {
        return send(res, 400, { error: '9つすべて選んでください' });
      }

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
          buyUrl:     typeof it.buyUrl === 'string' && /^https:\/\//.test(it.buyUrl)
                        ? it.buyUrl.slice(0, 400) : null,
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

      // OGP画像を先に作っておく。
      // SNSのクローラーは数秒で諦めるため、貼られてから作り始めると
      // 間に合わず、サムネイルが出ないことがある。
      // 応答は待たせない（失敗しても共有ページ自体は動く）。
      // 保存した内容をそのまま渡す（DBへの往復を1回減らす）
      warmOgImage(id, { id, type: body.type, title: body.title, items:
        clean.map((it, i) => it && ({ position: i, image_url: it.imageUrl })).filter(Boolean) });

      return send(res, 200, { id, shareable, uploads, stats: await store.stats() });
    }

    // 一覧（最新順・人気順・検索・SNSハンドル絞り込み）
    if (url.pathname === '/x/cards' && req.method === 'GET') {
      const type   = url.searchParams.get('type');
      const notType = url.searchParams.get('notype');
      const sort   = url.searchParams.get('sort') === 'hot' ? 'hot' : 'new';
      const handle = (url.searchParams.get('handle') || '').replace(/^@/, '').slice(0, 30) || null;
      const kw     = (url.searchParams.get('q') || '').slice(0, 40) || null;
      const limit  = Math.min(Number(url.searchParams.get('limit')) || 24, 48);
      const offset = Math.max(Number(url.searchParams.get('offset')) || 0, 0);
      if (type && !TYPES.has(type)) return send(res, 400, { error: '種別が不正です' });
      if (notType && !TYPES.has(notType)) return send(res, 400, { error: '種別が不正です' });

      // /trends を開くたびに走る。30秒だけ持たせてDBの稼働時間を抑える。
      // 個人ページ（handle）と絞り込み検索（q）は件数が読めないので素通し。
      const listKey = (handle || kw) ? null
        : `list:${type}:${notType}:${sort}:${limit}:${offset}`;
      let items = listKey ? cacheGet(listKey) : null;
      if (!items) {
        items = await (listKey
          ? once(listKey, () => store.list({ type, notType, sort, handle, q: kw, limit, offset }))
          : store.list({ type, notType, sort, handle, q: kw, limit, offset }));
        if (listKey) cacheSet(listKey, items, 30e3);
      }
      return send(res, 200, { items });
    }

    // カード1件の中身。みんなの9つで拡大表示するときに使う
    if (url.pathname === '/x/card') {
      const id = (url.searchParams.get('id') || '').trim();
      if (!/^[\w-]{4,20}$/.test(id)) return send(res, 400, { error: 'idが不正です' });

      const card = await store.get(id);
      if (!card) return send(res, 404, { error: '見つかりません' });

      countView(id);   // 閲覧数はまとめて書く（3分おき）
      const items = (card.items || []).map(it => ({
        position: it.position, title: it.title, sub: it.sub,
        image_url: it.image_url, year: it.year,
        links: P.buyLinks(card.type, { title: it.title, buyUrl: it.buy_url || '' }),
      }));
      return send(res, 200, {
        id: card.id, type: card.type, title: card.title, name: card.name,
        handle: card.handle, views: card.views, likes: card.likes,
        created_at: card.created_at, items,
      });
    }

    // 作品ランキング。言語・作品の年代・作った人の年齢層で絞れる
    if (url.pathname === '/x/top') {
      const type    = url.searchParams.get('type');
      const notType = url.searchParams.get('notype');
      const lang    = url.searchParams.get('lang');
      const decade  = Number(url.searchParams.get('decade')) || null;
      const ageBand = Number(url.searchParams.get('age')) || null;
      const limit   = Math.min(Number(url.searchParams.get('limit')) || 9, 30);
      if (type && !TYPES.has(type)) return send(res, 400, { error: '種別が不正です' });
      if (notType && !TYPES.has(notType)) return send(res, 400, { error: '種別が不正です' });

      const key = `top:${type}:${notType}:${lang}:${decade}:${ageBand}:${limit}`;
      const hit = cacheGet(key);
      if (hit) return send(res, 200, { items: hit, cached: true });

      const items = await store.top({
        type, notType, limit,
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

      /* 誰が押したかは、端末が持つIDで見分ける。
         IPだと、同じ回線を共有している人（スマホのCGNAT）が
         押せなくなってしまう。IDを送れない設定のときだけIPに落とす。 */
      const cid = /^[a-z0-9]{16,40}$/i.test(String(body.cid || ''))
        ? String(body.cid) : 'ip-' + hashIP(ip);
      const mark = `like:${cid}:${id}`;

      // 手前のメモリで弾く（大半はここで終わる）
      if (likedMark.has(mark)) return send(res, 200, { likes: null, already: true });

      /* 記録は保存先にも残す。メモリだけだと再起動で消えて押し直せてしまう。
         「一度きり」にするため、期限は10年にしてある。 */
      if (store && typeof store.cacheGet === 'function') {
        try {
          if (await store.cacheGet(mark)) {
            likedMark.set(mark, Date.now());
            return send(res, 200, { likes: null, already: true });
          }
        } catch { /* 読めなくても、メモリ側の判定で続ける */ }
      }

      // 同じ端末IDで大量に押されるのを防ぐ（1分に20件まで）
      if (rateLimited('like:' + cid, 20, 60e3)) {
        return send(res, 429, { error: 'いいねが多すぎます。少し待ってください。' });
      }

      likedMark.set(mark, Date.now());
      if (store && typeof store.cacheSet === 'function') {
        Promise.resolve(store.cacheSet(mark, 1, 10 * 365 * 24 * 3600e3)).catch(() => {});
      }

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
        bookEnabled: P.hasRakuten(),
      });
    }

    if (url.pathname.startsWith('/x/')) {
      if (rateLimited(ip)) return send(res, 429, { error: 'リクエストが多すぎます。少し待ってください。' });
    }

    if (url.pathname === '/x/search' || url.pathname === '/x/suggest') {
      const kind = url.pathname.endsWith('suggest') ? 'suggest' : 'search';

      // 補完は打鍵のたびに飛んでくるので、IP単位でさらに絞る
      if (kind === 'suggest' && rateLimited('sg:' + ip, 300, 60e3)) {
        return send(res, 200, { items: [] });   // 静かに空を返す
      }
      const type = url.searchParams.get('type') || '';
      const q    = (url.searchParams.get('q') || '').trim();

      if (!TYPES.has(type)) return send(res, 400, { error: '種別が不正です' });
      if (!q)              return send(res, 400, { error: '検索語を入れてください' });
      if (q.length > 80)   return send(res, 400, { error: '検索語が長すぎます' });

      const lang = url.searchParams.get('lang') === 'en' ? 'en' : 'ja';
      // キャッシュキーは表記ゆれを吸収してから作る。
      // 「ＮＡＲＵＴＯ」「NARUTO」「NARUTO 」を別々に持つと、同じ作品を
      // 探しているだけなのに外部APIを何度も叩くことになる。
      const key = `${kind}:${type}:${lang}:${P.cacheKey(q).toLowerCase()}`;
      const fetchFresh = async () => {
        let r = kind === 'suggest' ? await P.suggest(type, q) : await P.search(type, q, lang);
        if (kind === 'search') r = r.map(it => ({ ...it, links: P.buyLinks(type, it) }));
        cacheSet2(key, r, TTL[kind]);   // 保存も取得した1人だけが行う
        return r;
      };

      const hit = await cacheGet2(key);
      if (hit) {
        // 期限切れでも、まず古い内容を返してから裏で取り直す
        if (hit.stale) refreshLater(key, TTL[kind], fetchFresh);
        return send(res, 200, { items: hit.value, cached: true, stale: hit.stale || undefined });
      }

      // ここから先は外部APIを叩く。回数を数えるのはこの時だけ
      if (rateLimited('up:' + ip, UPSTREAM_PER_MIN, 60e3)) {
        return send(res, 429, { error: 'リクエストが多すぎます。少し待ってください。' });
      }
      const items = await once(key, fetchFresh);
      return send(res, 200, { items });
    }

    if (url.pathname === '/x/creators') {
      const type = url.searchParams.get('type') || '';
      const qs   = (url.searchParams.get('q') || '').trim();
      if (!TYPES.has(type)) return send(res, 400, { error: '種別が不正です' });
      if (!qs)              return send(res, 400, { error: '名前を入れてください' });
      if (qs.length > 80)   return send(res, 400, { error: '検索語が長すぎます' });

      const key = `creators:${type}:${P.cacheKey(qs).toLowerCase()}`;
      const fetchFresh = async () => {
        const r = await P.creators(type, qs);
        cacheSet2(key, r, TTL.search);
        return r;
      };
      const hit = await cacheGet2(key);
      if (hit) {
        if (hit.stale) refreshLater(key, TTL.search, fetchFresh);
        return send(res, 200, { items: hit.value, cached: true, stale: hit.stale || undefined });
      }

      if (rateLimited('up:' + ip, UPSTREAM_PER_MIN, 60e3)) {
        return send(res, 429, { error: 'リクエストが多すぎます。少し待ってください。' });
      }
      const items = await once(key, fetchFresh);
      return send(res, 200, { items });
    }

    if (url.pathname === '/x/works') {
      const type   = url.searchParams.get('type') || '';
      const id     = url.searchParams.get('id') || '';
      const author = (url.searchParams.get('author') || '').slice(0, 60);
      if (!TYPES.has(type)) return send(res, 400, { error: '種別が不正です' });
      if (type !== 'book' && !/^\d+$/.test(id)) return send(res, 400, { error: 'idが不正です' });
      if (type === 'book' && !author) return send(res, 400, { error: '著者名が必要です' });

      const key = `works:${type}:${id}:${P.cacheKey(author).toLowerCase()}`;
      const fetchFresh = async () => {
        const r = (await P.works(type, id, { author }))
          .map(it => ({ ...it, links: P.buyLinks(type, it) }));
        cacheSet2(key, r, TTL.search);
        return r;
      };
      const hit = await cacheGet2(key);
      if (hit) {
        if (hit.stale) refreshLater(key, TTL.search, fetchFresh);
        return send(res, 200, { items: hit.value, cached: true, stale: hit.stale || undefined });
      }

      if (rateLimited('up:' + ip, UPSTREAM_PER_MIN, 60e3)) {
        return send(res, 429, { error: 'リクエストが多すぎます。少し待ってください。' });
      }
      const items = await once(key, fetchFresh);
      return send(res, 200, { items });
    }

    if (url.pathname === '/x/related') {
      const type = url.searchParams.get('type') || '';
      const id   = url.searchParams.get('id') || '';
      if (!TYPES.has(type))   return send(res, 400, { error: '種別が不正です' });
      if (!/^\d+$/.test(id))  return send(res, 400, { error: 'idが不正です' });

      const key = `related:${type}:${id}`;
      const fetchFresh = async () => {
        const r = (await P.related(type, id))
          .map(it => ({ ...it, links: P.buyLinks(type, it) }));
        cacheSet2(key, r, TTL.search);
        return r;
      };
      const hit = await cacheGet2(key);
      if (hit) {
        if (hit.stale) refreshLater(key, TTL.search, fetchFresh);
        return send(res, 200, { items: hit.value, cached: true, stale: hit.stale || undefined });
      }

      if (rateLimited('up:' + ip, UPSTREAM_PER_MIN, 60e3)) {
        return send(res, 429, { error: 'リクエストが多すぎます。少し待ってください。' });
      }
      const items = await once(key, fetchFresh);
      return send(res, 200, { items });
    }

    if (url.pathname === '/about') return serveStatic('/about.html', res);
    if (url.pathname === '/terms')  return serveStatic('/terms.html', res);
    if (url.pathname === '/trends')  return serveStatic('/trends.html', res);
    if (url.pathname === '/contact') return serveStatic('/contact.html', res);
    if (url.pathname === '/favicon.ico') return serveStatic('/favicon.png', res);

    /* ---------- 共有ページ ----------
       /c/xxxxxxxx  … 9つを見せるページ（OGPタグ付き）
       /og/xxxxxxxx.png … SNSのサムネイル用画像
       アップロードされた画像は保存していないため、その枠は空欄で表示される。 */
    if (url.pathname.startsWith('/og/') && url.pathname.endsWith('.png')) {
      const id = url.pathname.slice(4, -4);
      if (!/^[\w-]{4,20}$/.test(id)) return send(res, 400, { error: 'idが不正です' });

      const key = 'og:' + id;
      const hit = imgCacheGet(key);
      if (hit) {
        res.writeHead(200, { 'Content-Type': 'image/png', 'Cache-Control': 'public, max-age=86400' });
        return res.end(hit);
      }
      // OGP画像の生成は9枚の画像を合成するためCPUを最も使う。
      // 同じカードのリンクがSNSに貼られると各社のクローラーが
      // ほぼ同時に取りに来るので、生成は1回にまとめる。
      const png = await once('ogrender:' + id, async () => {
        const card = await store.get(id);
        if (!card) return null;
        return ogimage.render(card, u => getImageBuffer(originalURL(u)));
      });
      if (!png) return send(res, 404, { error: 'not found' });
      imgCacheSet(key, png, TTL.img);
      res.writeHead(200, { 'Content-Type': 'image/png', 'Cache-Control': 'public, max-age=86400' });
      return res.end(png);
    }

    if (url.pathname.startsWith('/c/')) {
      const id = url.pathname.slice(3).replace(/\/$/, '');
      if (!/^[\w-]{4,20}$/.test(id)) return serveStatic('/index.html', res);

      // 共有ページは拡散すると同じIDに一斉にアクセスが来る。
      // 中身は作成後に変わらないので5分持たせ、取得も1本にまとめる。
      const ckey = 'card:' + id;
      let card = cacheGet(ckey);
      if (!card) {
        card = await once(ckey, () => store.get(id));
        if (card) cacheSet(ckey, card, 5 * 60e3);
      }
      if (!card) {
        res.writeHead(404, { 'Content-Type': 'text/html; charset=utf-8' });
        return res.end('<meta charset="utf-8"><p>このページは見つかりませんでした。'
          + '<a href="/">トップへ</a></p>');
      }
      countView(id);   // 閲覧数はまとめて書く（3分おき）
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
    // 期限切れの検索キャッシュも落とす。放っておくと保存容量を食う
    if (typeof store.cacheSweep === 'function') {
      const m = await store.cacheSweep();
      if (m) console.log(`掃除: 期限切れのキャッシュ ${m} 件を削除しました`);
    }
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
