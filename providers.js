/**
 * providers.js — 外部データソースのアダプタ
 *
 *  種別      検索/画像                                  キー
 *  --------  ----------------------------------------  --------------------
 *  album     iTunes Search API                          不要
 *  manga     AniList GraphQL (MANGA)                    不要
 *  anime     AniList GraphQL (ANIME)                    不要
 *  movie     TMDB                                       TMDB_API_KEY
 *  person    Wikipedia + TMDB人物 + YouTubeチャンネル    後ろ2つは任意
 *
 * 正規化した戻り値:
 *   { id, source, title, sub, img, relatedId, relatedCount, relationLabel? }
 */

// Wikimedia系APIは、連絡先を含むUser-Agentを求めている。
// 環境変数 CONTACT_URL / CONTACT_MAIL を設定すると、それが使われる。
const UA = `MyNine/1.0 (${process.env.CONTACT_URL || 'https://nine-1jsh.onrender.com'}; ${process.env.CONTACT_MAIL || 'noreply@example.com'})`;
const TMDB_KEY = process.env.TMDB_API_KEY || '';
const YT_KEY   = process.env.YOUTUBE_API_KEY || '';

const IMG_HOSTS = [
  /^s\d\.anilist\.co$/,
  /^is\d-ssl\.mzstatic\.com$/,
  /^a\d\.mzstatic\.com$/,
  /^image\.tmdb\.org$/,
  /^upload\.wikimedia\.org$/,
  /^commons\.wikimedia\.org$/,
  /^yt\d\.ggpht\.com$/,
  /^yt\d\.googleusercontent\.com$/,
  /^i\.ytimg\.com$/,
  /^lh\d\.googleusercontent\.com$/,
  /^thumbnail\.image\.rakuten\.co\.jp$/,
  /^books\.google\.com$/,
  /^books\.google\.co\.jp$/,
];

const proxied = url => (url ? '/img?u=' + encodeURIComponent(url) : '');

/* 言語。'ja' か 'en'。各APIに渡す値をここで一元管理する */
const LANG = {
  ja: { tmdb:'ja-JP', wiki:'ja', itunes:'JP', wikiHost:'ja.wikipedia.org' },
  en: { tmdb:'en-US', wiki:'en', itunes:'US', wikiHost:'en.wikipedia.org' },
};
const langOf = l => LANG[l] || LANG.ja;

/* ================================================================== *
 * 表記ゆれの吸収
 *
 * 日本語の検索でいちばん多い失敗は次の4つ。
 *   1. 全角と半角の違い     ＮＡＲＵＴＯ / NARUTO
 *   2. ひらがなとカタカナ   すらむだんく / スラムダンク
 *   3. 中黒や空白の有無     ワンピース / ワン・ピース / ONE PIECE
 *   4. 長音記号のゆれ       ハンター / ハンタ―（別文字）
 * ここで比較用のキーを作り、当たらなければ変換した語で追撃する。
 * ※「よみがな→漢字」だけは辞書が要るため対象外（Wikipediaの全文検索が吸収する）。
 * ================================================================== */

const toHalfWidth = s => s
  .replace(/[Ａ-Ｚａ-ｚ０-９]/g, c => String.fromCharCode(c.charCodeAt(0) - 0xfee0))
  .replace(/　/g, ' ');

const kataToHira = s => s.replace(/[\u30a1-\u30f6]/g, c => String.fromCharCode(c.charCodeAt(0) - 0x60));
const hiraToKata = s => s.replace(/[\u3041-\u3096]/g, c => String.fromCharCode(c.charCodeAt(0) + 0x60));

/** 入力そのものの整形（外部APIに投げる文字列） */
function normalize(s) {
  return toHalfWidth(s || '')
    .replace(/[‐‑‒–—―ー－ｰ]/g, 'ー')     // 長音記号のゆれを統一
    .replace(/\s+/g, ' ')
    .trim();
}

/** 比較専用のキー。記号と空白を落とし、カタカナはひらがなに寄せる */
function key(s) {
  return kataToHira(toHalfWidth(s || '').toLowerCase())
    .replace(/[ー〜~]/g, '')
    .replace(/[\s・･:：;；,，.。!！?？'"“”‘’\-–—_()（）\[\]【】「」『』/／]/g, '');
}

/** 検索に使う候補を優先順に返す（重複は除く） */
function variants(term) {
  const base = normalize(term);
  const list = [
    base,
    hiraToKata(base),                       // すらむだんく → スラムダンク
    kataToHira(base),                       // スラムダンク → すらむだんく
    base.replace(/[・･\s]/g, ''),           // ワン・ピース → ワンピース
  ];
  return [...new Set(list.filter(Boolean))];
}

/** 2文字ずつの重なり具合で似ている度合いを出す（0〜1） */
function dice(a, b) {
  if (!a || !b) return 0;
  if (a === b) return 1;
  if (a.length < 2 || b.length < 2) return a === b ? 1 : 0;
  const grams = s => { const m = new Map(); for (let i = 0; i < s.length - 1; i++) { const g = s.slice(i, i + 2); m.set(g, (m.get(g) || 0) + 1); } return m; };
  const ga = grams(a), gb = grams(b);
  let hit = 0, total = 0;
  for (const [g, n] of ga) { total += n; hit += Math.min(n, gb.get(g) || 0); }
  for (const n of gb.values()) total += n;
  return (2 * hit) / total;
}

/** 検索語との近さで並べ替える。候補文字列は複数持てる（原題・ローマ字など） */
function rank(items, term) {
  const keys = variants(term).map(key);
  return items
    .map(it => {
      const cands = [it.title, it.sub, ...(it._alts || [])].filter(Boolean).map(key);
      let best = 0;
      for (const k of keys) for (const c of cands) {
        let sc = dice(k, c);
        if (c.startsWith(k)) sc = Math.max(sc, 0.95);   // 前方一致は強い手がかり
        else if (c.includes(k)) sc = Math.max(sc, 0.8);
        best = Math.max(best, sc);
      }
      return { it, best };
    })
    .sort((a, b) => b.best - a.best)
    .map(({ it }) => { delete it._alts; return it; });
}

/** 重複を潰しつつ結合 */
function mergeBy(fn, ...lists) {
  const out = [], seen = new Set();
  for (const list of lists) for (const it of list || []) {
    const k = fn(it);
    if (seen.has(k)) continue;
    seen.add(k); out.push(it);
  }
  return out;
}

/**
 * 1つ目の候補で十分な件数が取れなければ、変換した語で追撃する。
 * 毎回すべての変換を投げると外部APIのレート制限に当たるため、必要なときだけ。
 */
async function fanout(term, fetcher, { enough = 5, max = 3 } = {}) {
  const vs = variants(term).slice(0, max);
  let acc = [];
  for (const v of vs) {
    const got = await fetcher(v);
    acc = mergeBy(x => `${x.source}:${x.id}`, acc, got);
    if (acc.length >= enough) break;
  }
  return acc;
}

/* ================================================================== *
 * 共通
 * ================================================================== */
function makeQueue(intervalMs) {
  let chain = Promise.resolve();
  const run = async fn => { const r = await fn(); await new Promise(s => setTimeout(s, intervalMs)); return r; };
  return fn => (chain = chain.then(() => run(fn), () => run(fn)));
}
const q = {
  anilist: makeQueue(700), itunes: makeQueue(350), tmdb: makeQueue(120),
  wiki: makeQueue(1200),      // Wikidata / Wikipedia。429を避けるため広めに
  commons: makeQueue(1200),   // 画像クレジット。別キューにして本体を邪魔しない
  yt: makeQueue(120),
  rakuten: makeQueue(1100),   // 楽天は1秒1リクエストが目安
  gbooks: makeQueue(200),
};

async function getJSON(url, opts = {}, retry = true) {
  const res = await fetch(url, {
    ...opts,
    headers: { 'User-Agent': UA, Accept: 'application/json', ...(opts.headers || {}) },
  });
  // 400や403は原因が本文に書かれていることが多いので、拾って表に出す
  if (res.status === 400 || res.status === 403) {
    const body = await res.text().catch(() => '');
    let detail = '';
    try { const j = JSON.parse(body); detail = j.error_description || j.error || ''; } catch {}
    throw new Error(`${new URL(url).hostname} が ${res.status} を返しました${detail ? '：' + detail : ''}`);
  }
  // 429（多すぎ）や503（一時的）は、少し待って1度だけやり直す
  if ((res.status === 429 || res.status === 503) && retry) {
    const wait = Number(res.headers.get('retry-after')) * 1000 || 2500;
    await new Promise(s => setTimeout(s, Math.min(wait, 5000)));
    return getJSON(url, opts, false);
  }
  if (!res.ok) throw new Error(`${new URL(url).hostname} が ${res.status} を返しました`);
  return res.json();
}

/* ================================================================== *
 * AniList（漫画・アニメ）
 * ================================================================== */
const ANILIST = 'https://graphql.anilist.co';

const MEDIA = `
  id type
  title { native romaji english }
  synonyms
  coverImage { extraLarge large }
  startDate { year }
  staff(perPage: 1, sort: RELEVANCE) { nodes { name { native full } } }
  studios(isMain: true) { nodes { name } }
`;

const Q_SEARCH = t => `query ($s: String) {
  Page(perPage: 18) { media(search: $s, type: ${t}, sort: SEARCH_MATCH, isAdult: false) {
    ${MEDIA} relations { edges { relationType node { id type } } } } }
}`;
const Q_RELATED = `query ($id: Int) {
  Media(id: $id) { relations { edges { relationType node { ${MEDIA} } } } }
}`;
const Q_SUGGEST = t => `query ($s: String) {
  Page(perPage: 8) { media(search: $s, type: ${t}, sort: SEARCH_MATCH, isAdult: false) {
    title { native romaji } startDate { year } } }
}`;

const REL_LABEL = {
  SEQUEL: '続編', PREQUEL: '前日譚', SIDE_STORY: '外伝', SPIN_OFF: 'スピンオフ',
  ALTERNATIVE: '別バージョン', PARENT: '本編', OTHER: '関連',
};
const REL_SKIP = new Set(['SUMMARY', 'CHARACTER', 'CONTAINS', 'COMPILATION', 'ADAPTATION', 'SOURCE']);

async function anilist(query, variables) {
  const json = await q.anilist(() => getJSON(ANILIST, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ query, variables }),
  }));
  if (json.errors?.length) throw new Error(json.errors[0].message);
  return json.data;
}

function shapeAniList(m, kind, relationType, lang = 'ja') {
  if (!m) return null;
  const sub = kind === 'anime'
    ? (m.studios?.nodes?.[0]?.name || '')
    : (m.staff?.nodes?.[0]?.name?.native || m.staff?.nodes?.[0]?.name?.full || '');
  const rel = (m.relations?.edges || [])
    .filter(e => e.node?.type === (kind === 'anime' ? 'ANIME' : 'MANGA') && !REL_SKIP.has(e.relationType));
  return {
    id: m.id,
    source: 'anilist',
    title: lang === 'en'
      ? (m.title?.english || m.title?.romaji || m.title?.native || '')
      : (m.title?.native || m.title?.romaji || m.title?.english || ''),
    sub,
    img: proxied(m.coverImage?.extraLarge || m.coverImage?.large),
    relatedId: m.id,
    relatedCount: rel.length,
    year: m.startDate?.year || null,
    // 並べ替え用の別名（ローマ字・英題・別表記）。送信前に削除される
    _alts: [m.title?.romaji, m.title?.english, m.title?.native, ...(m.synonyms || [])].filter(Boolean),
    ...(relationType ? { relationLabel: REL_LABEL[relationType] || '関連' } : {}),
  };
}

/* ================================================================== *
 * iTunes Search（アルバム）
 * ================================================================== */
function shapeAlbum(a) {
  return {
    id: a.collectionId,
    source: 'itunes',
    title: a.collectionName || '',
    sub: a.artistName || '',
    img: proxied((a.artworkUrl100 || '').replace('100x100bb', '600x600bb')),
    year: a.releaseDate ? Number(String(a.releaseDate).slice(0,4)) : null,
    relatedId: a.artistId || null,
    relatedCount: a.artistId ? 1 : 0,
    _alts: [a.collectionCensoredName, a.artistName].filter(Boolean),
  };
}
/**
 * iTunesのアルバム検索。
 * entity=album だけだと、曲名やサウンドトラックで引っかからないことが多い。
 * 見つからないときは曲（musicTrack）も探し、その曲が入っているアルバムに読み替える。
 */
const itunesSearch = async (term, limit = 18) => {
  const base = `https://itunes.apple.com/search?term=${encodeURIComponent(term)}&country=JP`;

  const albums = await q.itunes(() => getJSON(`${base}&entity=album&limit=${limit}`))
    .then(j => (j.results || []).map(shapeAlbum).filter(x => x.img))
    .catch(() => []);

  if (albums.length >= 6) return albums;

  // 曲名から辿る（サウンドトラックや、アルバム名と曲名が違うものに効く）
  const tracks = await q.itunes(() => getJSON(`${base}&entity=musicTrack&limit=${limit}`))
    .then(j => (j.results || []).map(t => shapeAlbum({
      collectionId: t.collectionId,
      collectionName: t.collectionName,
      artistName: t.artistName,
      artworkUrl100: t.artworkUrl100,
      releaseDate: t.releaseDate,
      artistId: t.artistId,
      collectionCensoredName: t.collectionCensoredName,
    })).filter(x => x.img && x.title))
    .catch(() => []);

  return mergeBy(x => `${x.source}:${x.id}`, albums, tracks);
};

/* ================================================================== *
 * TMDB（映画・人物）
 * ================================================================== */
function tmdbURL(pathname, params = {}, lang = 'ja') {
  const u = new URL('https://api.themoviedb.org/3' + pathname);
  u.searchParams.set('api_key', TMDB_KEY);
  u.searchParams.set('language', langOf(lang).tmdb);
  Object.entries(params).forEach(([k, v]) => u.searchParams.set(k, v));
  return u.toString();
}
function requireTMDB() {
  if (!TMDB_KEY) {
    const e = new Error('映画検索にはTMDBのAPIキーが必要です。環境変数 TMDB_API_KEY を設定してください。');
    e.status = 503;
    throw e;
  }
}
function shapeMovie(m) {
  return {
    id: m.id, source: 'tmdb',
    title: m.title || m.original_title || '',
    sub: (m.release_date || '').slice(0, 4),
    img: m.poster_path ? proxied('https://image.tmdb.org/t/p/w500' + m.poster_path) : '',
    year: m.release_date ? Number(m.release_date.slice(0, 4)) : null,
    relatedId: m.id, relatedCount: 1,
    _alts: [m.original_title].filter(Boolean),
  };
}

const DEPT = { Acting: '俳優', Directing: '監督', Writing: '脚本', Production: 'プロデューサー', Sound: '音楽', Camera: '撮影' };
function shapePerson(p) {
  return {
    id: 'tmdb-' + p.id, source: 'tmdb',
    title: p.name || '',
    sub: DEPT[p.known_for_department] || (p.known_for?.[0]?.title ? '映画・TV' : ''),
    img: p.profile_path ? proxied('https://image.tmdb.org/t/p/w500' + p.profile_path) : '',
    relatedId: null, relatedCount: 0,
    _alts: [p.original_name, ...(p.also_known_as || [])].filter(Boolean),
  };
}

/* ================================================================== *
 * YouTube（配信者・クリエイター）
 * search.list は1回100ユニット、無料枠は1日10,000ユニット＝約100回。
 * キャッシュ前提で使うこと。
 * ================================================================== */
/* YouTube search.list は1回100ユニット、無料枠は1日10,000ユニット＝100回。
   すぐ枯れるので、1日の呼び出し回数に上限を設けて守る。
   枯れても他のソースで結果は出るので、利用者には影響が出にくい。 */
const YT_BUDGET = Number(process.env.YOUTUBE_DAILY_SEARCHES) || 80;
let ytUsed = 0;
let ytDay = new Date().toDateString();

function ytAllowed() {
  const today = new Date().toDateString();
  if (today !== ytDay) { ytDay = today; ytUsed = 0; }
  return ytUsed < YT_BUDGET;
}

async function searchYouTube(term) {
  if (!YT_KEY) return [];
  if (!ytAllowed()) return [];   // 予算切れ。静かに諦める
  const u = new URL('https://www.googleapis.com/youtube/v3/search');
  u.searchParams.set('part', 'snippet');
  u.searchParams.set('type', 'channel');
  u.searchParams.set('maxResults', '8');
  u.searchParams.set('q', term);
  u.searchParams.set('key', YT_KEY);
  try {
    ytUsed++;
    const json = await q.yt(() => getJSON(u.toString()));
    return (json.items || []).map(it => ({
      id: 'yt-' + (it.id?.channelId || it.snippet?.channelId),
      source: 'youtube',
      title: it.snippet?.channelTitle || it.snippet?.title || '',
      sub: 'YouTube',
      img: proxied(it.snippet?.thumbnails?.high?.url || it.snippet?.thumbnails?.default?.url || ''),
      relatedId: null, relatedCount: 0,
    })).filter(x => x.img && x.title);
  } catch (e) {
    return [];   // 枠切れなどで落ちても他のソースは活かす
  }
}

/* ================================================================== *
 * Wikipedia（有名人・クリエイター全般）
 * ================================================================== */
const wikiURL = params => {
  const u = new URL('https://ja.wikipedia.org/w/api.php');
  Object.entries({ format: 'json', formatversion: 2, ...params }).forEach(([k, v]) => u.searchParams.set(k, v));
  return u.toString();
};

async function searchWiki(term) {
  const json = await q.wiki(() => getJSON(wikiURL({
    action: 'query', generator: 'search', gsrsearch: term, gsrlimit: 20, gsrnamespace: 0,
    prop: 'pageimages|pageterms', piprop: 'thumbnail', pithumbsize: 500, wbptterms: 'description',
  })));
  return (json.query?.pages || [])
    .filter(p => p.thumbnail?.source)
    .map(p => ({
      id: 'wiki-' + p.pageid, source: 'wikipedia',
      title: p.title.replace(/\s*\(.+?\)$/, ''),
      sub: (p.terms?.description?.[0] || '').slice(0, 24),
      img: proxied(p.thumbnail.source),
      relatedId: null, relatedCount: 0,
      _alts: [p.title],
    }));
}

/* ================================================================== *
 * 公開インターフェース
 * ================================================================== */
/** 一覧に購入・視聴リンクを付けて返す */
function withLinks(type, items) {
  return items.map(it => ({ ...it, links: buyLinks(type, it) }));
}

async function search(type, rawQuery, lang = 'ja') {
  const term = normalize(rawQuery);

  if (type === 'manga' || type === 'anime') {
    const gql = Q_SEARCH(type === 'anime' ? 'ANIME' : 'MANGA');
    const items = await fanout(term, async v => {
      const data = await anilist(gql, { s: v });
      return (data.Page?.media || []).map(m => shapeAniList(m, type, null, lang)).filter(x => x?.img);
    });
    return rank(items, term);
  }

  if (type === 'album') {
    return rank(await fanout(term, v => itunesSearch(v)), term);
  }

  if (type === 'movie') {
    requireTMDB();
    const items = await fanout(term, async v => {
      const json = await q.tmdb(() => getJSON(tmdbURL('/search/movie', { query: v, include_adult: 'false' }, lang)));
      return (json.results || []).map(shapeMovie).filter(x => x.img);
    });
    return rank(items, term);
  }

  if (type === 'character') {
    return rank(await searchCharacters(term, lang), term);
  }

  if (type === 'book') {
    // 英語では楽天が使えない（日本の書籍のみ）ので Google Books を主軸にする
    if (lang === 'en') return rank(await searchGoogleBooks(term), term);

    // 紙 → 電子（Kobo）→ Google Books の順に補う
    let books = foldEditions(await fanout(term, v => searchRakutenBooks(v), { enough: 6, max: 2 }));
    if (books.length < 8) {
      const kobo = foldEditions(await searchKobo(term));
      books = mergeBy(x => bookKey(x.title), books, kobo);
    }
    if (books.length < 4) {
      const g = await searchGoogleBooks(term);
      books = mergeBy(x => bookKey(x.title), books, g);
    }
    return rank(books, term).slice(0, 24);
  }

  if (type === 'person') {
    // Wikidataを主軸に、俳優はTMDB、配信者はYouTubeで補う。
    // 同じ人物は名前で1つにまとめる（先に来たソースを優先）
    const [wd, tmdb] = await Promise.all([
      fanout(term, v => wikidataPeople(v, lang), { enough: 3, max: 2 }).catch(() => []),
      TMDB_KEY
        ? q.tmdb(() => getJSON(tmdbURL('/search/person', { query: term, include_adult: 'false' }, lang)))
            .then(j => (j.results || []).map(shapePerson).filter(x => x.img))
            .catch(() => [])
        : [],
    ]);

    let merged = mergeBy(x => key(x.title) || x.id, wd, tmdb);

    // 配信者・クリエイターは他で拾えないので、結果が少ないときだけYouTubeを使う
    if (merged.length < 5) {
      const yt = await searchYouTube(term);
      merged = mergeBy(x => key(x.title) || x.id, merged, yt);
    }

    // どれも薄いときだけ、従来のWikipedia全文検索で拾い直す
    if (merged.length < 4) {
      const wiki = await searchWiki(term).catch(() => []);
      merged = mergeBy(x => key(x.title) || x.id, merged, wiki);
    }
    return rank(merged, term).slice(0, 24);
  }

  throw Object.assign(new Error('未対応の種別です'), { status: 400 });
}

async function suggest(type, rawQuery) {
  const term = normalize(rawQuery);
  if (term.length < 2) return [];
  const dedupe = list => mergeBy(x => key(x.label), list).slice(0, 8);

  if (type === 'manga' || type === 'anime') {
    const gql = Q_SUGGEST(type === 'anime' ? 'ANIME' : 'MANGA');
    const got = await fanout(term, async v => {
      const data = await anilist(gql, { s: v });
      return (data.Page?.media || []).map(m => ({
        id: m.title?.native || m.title?.romaji, source: 'x',
        label: m.title?.native || m.title?.romaji || '',
        sub: m.startDate?.year ? String(m.startDate.year) : '',
        title: m.title?.native || m.title?.romaji || '',
        _alts: [m.title?.romaji].filter(Boolean),
      })).filter(x => x.label);
    }, { enough: 4, max: 2 });
    return dedupe(rank(got, term)).map(({ label, sub }) => ({ label, sub }));
  }

  if (type === 'album') {
    const got = await fanout(term, async v => (await itunesSearch(v, 8)).map(a => ({
      id: a.id, source: 'itunes', label: a.title, sub: a.sub, title: a.title,
    })), { enough: 4, max: 2 });
    return dedupe(rank(got, term)).map(({ label, sub }) => ({ label, sub }));
  }

  if (type === 'movie') {
    requireTMDB();
    const got = await fanout(term, async v => {
      const json = await q.tmdb(() => getJSON(tmdbURL('/search/movie', { query: v, include_adult: 'false' })));
      return (json.results || []).slice(0, 8).map(m => ({
        id: m.id, source: 'tmdb', label: m.title || m.original_title,
        sub: (m.release_date || '').slice(0, 4), title: m.title || m.original_title,
        _alts: [m.original_title].filter(Boolean),
      })).filter(x => x.label);
    }, { enough: 4, max: 2 });
    return dedupe(rank(got, term)).map(({ label, sub }) => ({ label, sub }));
  }

  if (type === 'book') {
    const got = await fanout(term, async v => {
      const books = foldEditions(await searchRakutenBooks(v));
      return books.slice(0, 8).map(b => ({
        id: b.id, source: 'rakuten', label: b.title, sub: b.sub, title: b.title, _alts: b._alts,
      }));
    }, { enough: 4, max: 2 });
    return dedupe(rank(got, term)).map(({ label, sub }) => ({ label, sub }));
  }

  if (type === 'character') {
    const got = await fanout(term, async v => {
      const data = await anilist(Q_CHARACTERS, { s: v });
      return (data.Page?.characters || []).map(c => {
        const x = shapeCharacter(c);
        return { id: x.id, source: 'anilist', label: x.title, sub: x.sub, title: x.title, _alts: x._alts };
      }).filter(x => x.label);
    }, { enough: 4, max: 2 });
    return dedupe(rank(got, term)).map(({ label, sub }) => ({ label, sub }));
  }

  if (type === 'person') {
    // opensearch は前方一致なので、当たらなければ全文検索に切り替える
    const got = await fanout(term, async v => {
      const json = await q.wiki(() => getJSON(wikiURL({ action: 'opensearch', search: v, limit: 8, namespace: 0 })));
      return (json[1] || []).map((label, i) => ({
        id: label, source: 'wiki',
        label: label.replace(/\s*\(.+?\)$/, ''),
        sub: (json[2]?.[i] || '').slice(0, 20),
        title: label,
      }));
    }, { enough: 4, max: 2 });

    if (got.length < 3 && TMDB_KEY) {
      const j = await q.tmdb(() => getJSON(tmdbURL('/search/person', { query: term }))).catch(() => null);
      (j?.results || []).slice(0, 6).forEach(p => got.push({
        id: 'tmdb-' + p.id, source: 'tmdb', label: p.name,
        sub: DEPT[p.known_for_department] || '', title: p.name,
      }));
    }
    return dedupe(rank(got, term)).map(({ label, sub }) => ({ label, sub }));
  }
  return [];
}

async function related(type, id) {
  if (type === 'manga' || type === 'anime') {
    const want = type === 'anime' ? 'ANIME' : 'MANGA';
    const data = await anilist(Q_RELATED, { id: Number(id) });
    return (data.Media?.relations?.edges || [])
      .filter(e => e.node?.type === want && !REL_SKIP.has(e.relationType))
      .map(e => shapeAniList(e.node, type, e.relationType))
      .filter(x => x?.img)
      .map(x => { delete x._alts; return x; });
  }
  if (type === 'album') {
    const url = `https://itunes.apple.com/lookup?id=${encodeURIComponent(id)}&entity=album&limit=25&country=JP`;
    const json = await q.itunes(() => getJSON(url));
    return (json.results || [])
      .filter(r => r.wrapperType === 'collection')
      .map(a => { const s = shapeAlbum(a); delete s._alts; return { ...s, relationLabel: '同アーティスト', relatedCount: 0 }; })
      .filter(x => x.img);
  }
  if (type === 'movie') {
    requireTMDB();
    const detail = await q.tmdb(() => getJSON(tmdbURL(`/movie/${Number(id)}`)));
    const shape = m => { const s = shapeMovie(m); delete s._alts; return s; };
    if (detail.belongs_to_collection?.id) {
      const col = await q.tmdb(() => getJSON(tmdbURL(`/collection/${detail.belongs_to_collection.id}`)));
      return (col.parts || []).filter(m => m.id !== detail.id)
        .map(m => ({ ...shape(m), relationLabel: 'シリーズ', relatedCount: 0 })).filter(x => x.img);
    }
    const rec = await q.tmdb(() => getJSON(tmdbURL(`/movie/${Number(id)}/recommendations`)));
    return (rec.results || []).slice(0, 12)
      .map(m => ({ ...shape(m), relationLabel: '関連', relatedCount: 0 })).filter(x => x.img);
  }
  return [];
}

/* ================================================================== *
 * 作者・アーティストから探す
 *
 * 作品名と人名を同じ検索窓で混ぜると候補が濁るため、
 * 「人を探す」→「その人の作品一覧」の2段階に分けている。
 * ================================================================== */

const Q_STAFF = `query ($s: String) {
  Page(perPage: 12) { staff(search: $s) {
    id name { native full } image { large }
    staffMedia(perPage: 1) { nodes { id } }
  } }
}`;

const Q_STAFF_WORKS = `query ($id: Int, $t: MediaType) {
  Staff(id: $id) {
    name { native full }
    staffMedia(type: $t, perPage: 40, sort: POPULARITY_DESC) {
      nodes { ${MEDIA} relations { edges { relationType node { id type } } } }
    }
  }
}`;

/** 人物の候補を返す（画像は無くてもよい） */
async function creators(type, rawQuery) {
  const term = normalize(rawQuery);

  if (type === 'manga' || type === 'anime') {
    const got = await fanout(term, async v => {
      const data = await anilist(Q_STAFF, { s: v });
      return (data.Page?.staff || [])
        .filter(s => s.staffMedia?.nodes?.length)
        .map(s => ({
          id: s.id, source: 'anilist',
          title: s.name?.native || s.name?.full || '',
          sub: s.name?.native && s.name?.full && s.name.native !== s.name.full ? s.name.full : '',
          img: proxied(s.image?.large || ''),
          _alts: [s.name?.full, s.name?.native].filter(Boolean),
        })).filter(x => x.title);
    }, { enough: 4, max: 3 });
    return rank(got, term);
  }

  if (type === 'album') {
    const got = await fanout(term, async v => {
      const url = `https://itunes.apple.com/search?term=${encodeURIComponent(v)}&entity=musicArtist&country=JP&limit=12`;
      const json = await q.itunes(() => getJSON(url));
      return (json.results || []).map(a => ({
        id: a.artistId, source: 'itunes',
        title: a.artistName || '', sub: a.primaryGenreName || '', img: '',
      })).filter(x => x.id && x.title);
    }, { enough: 4, max: 3 });
    return rank(got, term);
  }

  if (type === 'book') {
    // 著者名で検索し、著者ごとにまとめて候補にする
    let books = await fanout(term, v => searchRakutenBooks(v, 'author'), { enough: 8, max: 2 });
    if (books.length < 8) books = books.concat(await searchKobo(term, 'author'));
    const byAuthor = new Map();
    books.forEach(b => {
      (b.sub || '').split(/[,、\/]/).map(a => a.trim()).filter(Boolean).forEach(a => {
        if (!byAuthor.has(a)) byAuthor.set(a, { id: 0, source: 'rakuten', title: a, sub: '', img: '', authorName: a });
      });
    });
    return rank([...byAuthor.values()], term).slice(0, 12);
  }

  if (type === 'movie') {
    requireTMDB();
    const got = await fanout(term, async v => {
      const json = await q.tmdb(() => getJSON(tmdbURL('/search/person', { query: v, include_adult: 'false' })));
      return (json.results || []).map(p => ({
        id: p.id, source: 'tmdb',
        title: p.name || '',
        sub: DEPT[p.known_for_department] || '',
        img: p.profile_path ? proxied('https://image.tmdb.org/t/p/w185' + p.profile_path) : '',
        _alts: [p.original_name].filter(Boolean),
      })).filter(x => x.title);
    }, { enough: 4, max: 2 });
    return rank(got, term);
  }

  return [];
}

/** その人物の作品一覧 */
async function works(type, id, extra = {}) {
  if (type === 'book') {
    const author = String(extra.author || '').slice(0, 60);
    if (!author) return [];
    const paper = await searchRakutenBooks(author, 'author');
    const kobo = paper.length < 12 ? await searchKobo(author, 'author') : [];
    return foldEditions(mergeBy(x => bookKey(x.title), paper, kobo)).slice(0, 30);
  }
  if (type === 'manga' || type === 'anime') {
    const data = await anilist(Q_STAFF_WORKS, { id: Number(id), t: type === 'anime' ? 'ANIME' : 'MANGA' });
    const seen = new Set();
    return (data.Staff?.staffMedia?.nodes || [])
      .map(m => shapeAniList(m, type))
      .filter(x => x?.img && !seen.has(x.id) && seen.add(x.id))
      .map(x => { delete x._alts; return x; });
  }
  if (type === 'album') {
    return related('album', id);          // 同アーティストのアルバム一覧と同じ
  }
  if (type === 'movie') {
    requireTMDB();
    const json = await q.tmdb(() => getJSON(tmdbURL(`/person/${Number(id)}/movie_credits`)));
    const all = [...(json.cast || []), ...(json.crew || [])];
    const seen = new Set();
    return all
      .filter(m => m.poster_path && !seen.has(m.id) && seen.add(m.id))
      .sort((a, b) => (b.release_date || '').localeCompare(a.release_date || ''))
      .slice(0, 40)
      .map(m => { const s = shapeMovie(m); delete s._alts; return s; });
  }
  return [];
}

/* ================================================================== *
 * Wikidata（人物）
 *
 * Wikipediaの全文検索は「人物かどうか」を見ないため、
 * 団体名・楽曲名・地名が同列に混ざってしまう。
 * Wikidataなら P31（分類）= Q5（ヒト）で厳密に絞り込める。
 * さらに別名（芸名・本名・ローマ字表記）が登録されているので表記ゆれにも強い。
 * ================================================================== */
const wdURL = params => {
  const u = new URL('https://www.wikidata.org/w/api.php');
  Object.entries({ format: 'json', ...params }).forEach(([k, v]) => u.searchParams.set(k, v));
  return u.toString();
};

const claimValues = (ent, prop) =>
  ((ent.claims || {})[prop] || []).map(c => c.mainsnak?.datavalue?.value).filter(Boolean);

const commonsImage = file =>
  'https://commons.wikimedia.org/wiki/Special:FilePath/' + encodeURIComponent(file) + '?width=500';

/**
 * Commonsの画像クレジットを引く（CC BY-SA の著作者表示義務に対応するため）
 * imageinfo の extmetadata から、著作者名とライセンス名を取り出す。
 * 失敗しても検索自体は止めない。
 */
const COMMONS = 'https://commons.wikimedia.org/w/api.php';

function stripTags(html) {
  return String(html || '')
    .replace(/<[^>]*>/g, '')
    .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&#0?39;/g, "'")
    .replace(/\s+/g, ' ')
    .trim();
}

async function commonsCredits(files) {
  const list = [...new Set(files.filter(Boolean))].slice(0, 10);
  if (!list.length) return {};
  try {
  return await fetchCredits(list);
  } catch (err) {
    console.warn('クレジット取得に失敗（検索は継続）:', err.message);
    return {};
  }
}

async function fetchCredits(list) {
  const u = new URL(COMMONS);
  Object.entries({
    action: 'query', format: 'json', formatversion: 2,
    prop: 'imageinfo', iiprop: 'extmetadata',
    iiextmetadatafilter: 'Artist|LicenseShortName|LicenseUrl|Credit',
    titles: list.map(f => 'File:' + f).join('|'),
  }).forEach(([k, v]) => u.searchParams.set(k, v));

  const json = await q.commons(() => getJSON(u.toString())).catch(() => null);
  const out = {};
  (json?.query?.pages || []).forEach(p => {
    const m = p.imageinfo?.[0]?.extmetadata || {};
    const file = String(p.title || '').replace(/^File:/, '');
    const author = stripTags(m.Artist?.value) || stripTags(m.Credit?.value);
    const license = stripTags(m.LicenseShortName?.value);
    if (author || license) {
      out[decodeURIComponent(file).replace(/_/g, ' ')] = {
        author: (author || '不明').slice(0, 60),
        license: license || '',
        licenseUrl: m.LicenseUrl?.value || '',
      };
    }
  });
  return out;
}

/* ================================================================== *
 * 書籍・小説
 *
 * 楽天ブックス書籍検索APIを主軸に、見つからないものをGoogle Booksで補う。
 * 楽天は商品単位のデータなので、同じ作品の単行本・文庫・電子書籍が
 * 別々に並ぶ。タイトルを正規化してまとめ、最古の版を代表として出す。
 * （漫画で「1巻の表紙」を出したのと同じ考え方）
 * ================================================================== */
const RAKUTEN_ID  = process.env.RAKUTEN_APP_ID || '';
const RAKUTEN_KEY = process.env.RAKUTEN_ACCESS_KEY || '';
const RAKUTEN_AFF = process.env.RAKUTEN_AFFILIATE_ID || '';

/**
 * 楽天ウェブサービスは2026年2月に刷新された。
 *   旧: app.rakuten.co.jp/services/api/...      applicationId だけで認証（5月13日で停止）
 *   新: openapi.rakuten.co.jp/services/api/...  applicationId + accessKey が必須
 *   （変わるのはドメインだけで、/services/api/ 以降のパスは同じ）
 * さらにリクエスト元が厳格にチェックされるため、Referer と Origin を明示して送る。
 * 送り先は、アプリ登録時に「許可されたWebサイト」に入れたドメインと一致させること。
 */
const RAKUTEN_ORIGIN = process.env.CONTACT_URL || 'https://nine-1jsh.onrender.com';

function rakutenURL(params) {
  const u = new URL('https://openapi.rakuten.co.jp/services/api/BooksBook/Search/20170404');
  u.searchParams.set('applicationId', RAKUTEN_ID);
  u.searchParams.set('accessKey', RAKUTEN_KEY);
  if (RAKUTEN_AFF) u.searchParams.set('affiliateId', RAKUTEN_AFF);
  u.searchParams.set('format', 'json');
  u.searchParams.set('hits', '30');
  u.searchParams.set('sort', 'sales');
  Object.entries(params).forEach(([k, v]) => u.searchParams.set(k, v));
  return u.toString();
}

const rakutenHeaders = (withOrigin = true) => {
  const h = { Referer: RAKUTEN_ORIGIN.replace(/\/$/, '') + '/' };
  if (withOrigin) h.Origin = RAKUTEN_ORIGIN.replace(/\/$/, '');
  return h;
};

/** 楽天を叩く。403のときはOriginを外して1度だけやり直す */
async function rakutenGet(url) {
  try {
    return await q.rakuten(() => getJSON(url, { headers: rakutenHeaders(true) }));
  } catch (e) {
    if (!/403/.test(e.message)) throw e;
    console.warn('楽天が403。Originを外して再試行します');
    return q.rakuten(() => getJSON(url, { headers: rakutenHeaders(false) }));
  }
}

/** 版の違いを無視して同じ作品にまとめるためのキー */
function bookKey(title) {
  return key(String(title || '')
    .replace(/[（(【\[].*?[）)】\]]/g, '')          // （文庫版）などを落とす
    .replace(/\s*(文庫|新書|上|下|上巻|下巻|完全版|新装版|愛蔵版|電子書籍版)\s*$/g, '')
    .replace(/\s*\d+\s*$/, ''));                    // 末尾の巻数
}

function shapeRakutenBook(b) {
  const img = b.largeImageUrl || b.mediumImageUrl || '';
  return {
    id: b.isbn || b.itemCode || '',
    source: 'rakuten',
    title: b.title || '',
    sub: b.author || b.publisherName || '',
    img: proxied(img.replace(/\?_ex=\d+x\d+$/, '')),
    // アフィリエイトリンク。作品の詳細でのみ表示する
    buyUrl: b.affiliateUrl || b.itemUrl || '',
    date: b.salesDate || '',
    year: (String(b.salesDate || '').match(/(\d{4})/) || [])[1] || null,
    relatedId: null, relatedCount: 0,
    _alts: [b.titleKana, b.subTitle, b.author].filter(Boolean),
  };
}

/** 同じ作品をまとめ、いちばん古い版を代表にする */
function foldEditions(books) {
  const groups = new Map();
  books.forEach(b => {
    const k = bookKey(b.title);
    const cur = groups.get(k);
    if (!cur) { groups.set(k, { rep: b, all: [b] }); return; }
    cur.all.push(b);
    const older = (b.date || '9999') < (cur.rep.date || '9999');
    if (older && b.img) cur.rep = b;
  });
  return [...groups.values()].map(g => ({
    ...g.rep,
    relatedCount: g.all.length > 1 ? g.all.length - 1 : 0,
    editions: g.all.length > 1 ? g.all.slice(0, 12) : null,
  }));
}

async function searchRakutenBooks(term, field = 'title') {
  if (!RAKUTEN_ID || !RAKUTEN_KEY) {
    const e = new Error('書籍検索には楽天のアプリIDとアクセスキーが必要です。'
      + '環境変数 RAKUTEN_APP_ID と RAKUTEN_ACCESS_KEY を設定してください。');
    e.status = 503;
    throw e;
  }
  const json = await rakutenGet(rakutenURL({ [field]: term }));
  return (json.Items || []).map(x => shapeRakutenBook(x.Item || x)).filter(b => b.img && b.title);
}

/**
 * 楽天Kobo（電子書籍）で補う。
 * 紙の本は絶版になると消えるが、電子版は残っていることが多い。
 * ただしジャケットが電子版用の別デザインのことがあるため、紙を優先し、
 * 見つからないときだけこちらを使う。
 */
function shapeKobo(b) {
  const img = b.largeImageUrl || b.mediumImageUrl || '';
  return {
    id: 'kobo-' + (b.itemNumber || b.itemUrl || ''),
    source: 'rakuten-kobo',
    title: (b.title || '').replace(/【電子書籍】$/, '').trim(),
    sub: b.author || b.publisherName || '',
    img: proxied(img.replace(/\?_ex=\d+x\d+$/, '')),
    buyUrl: b.affiliateUrl || b.itemUrl || '',
    date: b.salesDate || '',
    relatedId: null, relatedCount: 0,
    _alts: [b.titleKana, b.author].filter(Boolean),
  };
}

async function searchKobo(term, field = 'title') {
  if (!RAKUTEN_ID || !RAKUTEN_KEY) return [];
  const u = new URL('https://openapi.rakuten.co.jp/services/api/Kobo/EbookSearch/20170426');
  u.searchParams.set('applicationId', RAKUTEN_ID);
  u.searchParams.set('accessKey', RAKUTEN_KEY);
  if (RAKUTEN_AFF) u.searchParams.set('affiliateId', RAKUTEN_AFF);
  u.searchParams.set('format', 'json');
  u.searchParams.set('hits', '30');
  u.searchParams.set(field, term);
  try {
    const json = await rakutenGet(u.toString());
    return (json.Items || []).map(x => shapeKobo(x.Item || x)).filter(b => b.img && b.title);
  } catch (e) {
    console.warn('Kobo検索に失敗（紙の結果は維持）:', e.message);
    return [];
  }
}

/** 楽天で見つからないもの（洋書など）をGoogle Booksで補う */
async function searchGoogleBooks(term) {
  const u = new URL('https://www.googleapis.com/books/v1/volumes');
  u.searchParams.set('q', term);
  u.searchParams.set('maxResults', '12');
  u.searchParams.set('country', 'JP');
  const json = await q.gbooks(() => getJSON(u.toString())).catch(() => null);
  return (json?.items || []).map(v => {
    const info = v.volumeInfo || {};
    const img = (info.imageLinks?.thumbnail || '').replace(/^http:/, 'https:').replace(/&zoom=\d/, '&zoom=1');
    return {
      id: 'gb-' + v.id, source: 'googlebooks',
      title: info.title || '',
      sub: (info.authors || []).join(', ') || info.publisher || '',
      img: proxied(img),
      buyUrl: '', date: info.publishedDate || '',
      relatedId: null, relatedCount: 0,
      _alts: (info.authors || []),
    };
  }).filter(b => b.img && b.title);
}

async function wikidataPeople(term, lang = 'ja') {
  const L = langOf(lang).wiki;
  const found = await q.wiki(() => getJSON(wdURL({
    action: 'wbsearchentities', search: term, language: L, uselang: L,
    type: 'item', limit: 20,
  })));
  const ids = (found.search || []).map(x => x.id);
  if (!ids.length) return [];

  const got = await q.wiki(() => getJSON(wdURL({
    action: 'wbgetentities', ids: ids.join('|'),
    props: 'claims|labels|descriptions|aliases', languages: `${L}|en`,
  })));
  const entities = Object.values(got.entities || {});

  // ヒトだけ残し、画像があるものに限る
  const people = entities.filter(e =>
    claimValues(e, 'P31').some(v => v.id === 'Q5') && claimValues(e, 'P18').length
  );
  if (!people.length) return [];

  // 職業（P106）のラベルをまとめて引く
  const occIds = [...new Set(people.map(e => claimValues(e, 'P106')[0]?.id).filter(Boolean))];
  let occLabels = {};
  if (occIds.length) {
    const lab = await q.wiki(() => getJSON(wdURL({
      action: 'wbgetentities', ids: occIds.slice(0, 50).join('|'),
      props: 'labels', languages: 'ja|en',
    }))).catch(() => null);
    Object.entries(lab?.entities || {}).forEach(([id, e]) => {
      occLabels[id] = e.labels?.ja?.value || e.labels?.en?.value || '';
    });
  }

  // 著作者表示のためクレジットをまとめて取得
  const credits = await commonsCredits(people.map(e => claimValues(e, 'P18')[0])).catch(() => ({}));

  return people.map(e => {
    const name = e.labels?.ja?.value || e.labels?.en?.value || '';
    const occ = occLabels[claimValues(e, 'P106')[0]?.id] || '';
    const aliases = [...(e.aliases?.ja || []), ...(e.aliases?.en || [])].map(a => a.value);
    const file = claimValues(e, 'P18')[0];
    const cr = credits[String(file || '').replace(/_/g, ' ')];
    return {
      id: 'wd-' + e.id, source: 'wikidata',
      title: name,
      sub: (occ || e.descriptions?.ja?.value || '').slice(0, 24),
      img: proxied(commonsImage(file)),
      relatedId: null, relatedCount: 0,
      // CC BY-SA の著作者表示に使う
      credit: cr ? { author: cr.author, license: cr.license } : null,
      _alts: [e.labels?.en?.value, ...aliases].filter(Boolean),
    };
  }).filter(x => x.title);
}

/* ================================================================== *
 * AniList（キャラクター）
 * 漫画・アニメ・ゲーム原作のキャラクターを横断で引ける。キー不要。
 * ================================================================== */
const Q_CHARACTERS = `query ($s: String) {
  Page(perPage: 18) { characters(search: $s, sort: SEARCH_MATCH) {
    id
    name { native full alternative }
    image { large }
    media(perPage: 1, sort: POPULARITY_DESC) { nodes { title { native romaji } } }
  } }
}`;

function shapeCharacter(c, lang = 'ja') {
  const from = c.media?.nodes?.[0]?.title;
  const en = lang === 'en';
  return {
    id: c.id, source: 'anilist',
    title: (en ? (c.name?.full || c.name?.native) : (c.name?.native || c.name?.full)) || '',
    sub: from ? (en ? (from.romaji || from.native) : (from.native || from.romaji)) || '' : '',
    img: proxied(c.image?.large || ''),
    relatedId: null, relatedCount: 0,
    _alts: [c.name?.full, c.name?.native, ...(c.name?.alternative || [])].filter(Boolean),
  };
}

async function searchCharacters(term, lang = 'ja') {
  return fanout(term, async v => {
    const data = await anilist(Q_CHARACTERS, { s: v });
    return (data.Page?.characters || [])
      .map(c => shapeCharacter(c, lang)).filter(x => x.img && x.title);
  });
}

/* ================================================================== *
 * 作品ごとの購入・視聴リンク
 *
 * 収益は「その9つを、今すぐ観る・読む・聴く手段」に限定して置く。
 * 作品を選ぶ画面の詳細部分にだけ出し、共有ページには出さない。
 *
 * VODについて: 「この作品がどこで配信中か」を返す無料APIは実質存在しない
 * （TMDBの配信情報はJustWatch由来で、アフィリエイト利用は規約上できない）。
 * そのため「作品名で検索するリンク」を置く形にしている。
 * ================================================================== */
const AMAZON_TAG = process.env.AMAZON_ASSOCIATE_TAG || '';
const VOD_LINKS  = process.env.VOD_LINKS ? safeJSON(process.env.VOD_LINKS) : null;

function safeJSON(t) { try { return JSON.parse(t); } catch { return null; } }

/**
 * Yahoo!ショッピングの検索リンク。
 *
 * MyLinkは「登録した1つのURL」への固定リンクなので、作品ごとに変えられない。
 * 代わりにLinkSwitchを使う。サイトに1行スクリプトを貼っておくと、
 * ページ内の通常のYahoo!ショッピングリンクが自動でアフィリエイト化される。
 * したがってここでは素の検索URLを出力すればよい。
 *
 * VC_LINKSWITCH に 'on' を設定すると表示される。
 */
const VC_ON = process.env.VC_LINKSWITCH === 'on';

function yahooSearch(keyword) {
  if (!VC_ON) return null;
  return 'https://shopping.yahoo.co.jp/search?p=' + encodeURIComponent(keyword);
}

/**
 * 楽天市場の検索リンク。アフィリエイトIDがあれば経由させる。
 * 書籍の「楽天ブックスで見る」は商品ページへの直リンクだが、
 * こちらは種類を問わず使える検索リンク。
 */
function rakutenSearch(keyword) {
  const target = 'https://search.rakuten.co.jp/search/mall/' + encodeURIComponent(keyword) + '/';
  if (!RAKUTEN_AFF) return null;
  return 'https://hb.afl.rakuten.co.jp/hgc/' + RAKUTEN_AFF + '/?pc='
    + encodeURIComponent(target) + '&m=' + encodeURIComponent(target);
}

function amazonSearch(keyword, category) {
  if (!AMAZON_TAG) return null;
  const u = new URL('https://www.amazon.co.jp/s');
  u.searchParams.set('k', keyword);
  if (category) u.searchParams.set('i', category);
  u.searchParams.set('tag', AMAZON_TAG);
  return u.toString();
}

/**
 * 種別ごとの導線を返す。
 * VOD_LINKS は環境変数でこう渡す（{q} が作品名に置き換わる）:
 *   {"U-NEXT":"https://px.a8.net/.../?k={q}","DMM TV":"https://..."}
 * A8やバリューコマースで発行したリンクをそのまま入れられる。
 */
function buyLinks(type, item) {
  const q = item.title || '';
  if (!q) return [];
  const out = [];

  if (item.buyUrl) {
    out.push({ label: '楽天ブックスで見る', url: item.buyUrl, kind: 'shop' });
  }

  const CATEGORY = {
    book: 'stripbooks', manga: 'stripbooks', cd: 'popular',
    movie: 'dvd', anime: 'dvd', character: null, person: null,
  };
  if (CATEGORY[type] !== undefined && CATEGORY[type] !== null) {
    const url = amazonSearch(q, CATEGORY[type]);
    if (url) out.push({ label: 'Amazonで探す', url, kind: 'shop' });
    if (!item.buyUrl) {
      const r = rakutenSearch(q);
      if (r) out.push({ label: '楽天市場で探す', url: r, kind: 'shop' });
    }
    const y = yahooSearch(q);
    if (y) out.push({ label: 'Yahoo!ショッピングで探す', url: y, kind: 'shop' });
  }

  // 映画・アニメだけ、配信サービスへの検索リンクを添える
  if ((type === 'movie' || type === 'anime') && VOD_LINKS) {
    Object.entries(VOD_LINKS).slice(0, 3).forEach(([name, tpl]) => {
      out.push({
        label: `${name}で探す`,
        url: String(tpl).replace('{q}', encodeURIComponent(q)),
        kind: 'vod',
      });
    });
  }
  return out;
}

module.exports = {
  search, suggest, related, creators, works, buyLinks, IMG_HOSTS,
  hasRakuten: () => !!(RAKUTEN_ID && RAKUTEN_KEY),
  hasTMDB: () => !!TMDB_KEY,
  hasYouTube: () => !!YT_KEY,
  _internal: { key, variants, dice, rank },   // テスト用
};
