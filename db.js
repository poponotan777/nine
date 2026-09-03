/**
 * db.js — 保存と集計
 *
 * Node 22 標準の node:sqlite を使う（追加パッケージなし）。
 * 使えない環境ではJSONファイルに自動で切り替わるので、どこでも動く。
 *
 * テーブル設計はランキング機能をそのまま載せられる形にしてある。
 *   cards       … 1枚のカード（9マスぶんのまとまり）
 *   card_items  … その中身。source + external_id で集計するとランキングになる
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, 'data');
fs.mkdirSync(DATA_DIR, { recursive: true });

const SALT = process.env.IP_SALT || 'change-me-in-production';
const hashIP = ip => crypto.createHash('sha256').update(SALT + (ip || '')).digest('hex').slice(0, 16);
const newId = () => crypto.randomBytes(6).toString('base64url');   // 8文字

/* ================================================================== *
 * PostgreSQL（Neonなどの外部DB）
 *
 * DATABASE_URL があればこれを最優先で使う。
 * Renderの無料枠はファイルシステムが揮発性で、再起動のたびに消えるため、
 * 公開環境ではこの経路が本命になる。
 * ================================================================== */
function openPostgres() {
  const url = process.env.DATABASE_URL;
  if (!url) return null;

  let Pool;
  try { ({ Pool } = require('pg')); }
  catch {
    console.warn('DATABASE_URL はあるが pg が未インストールです。npm install pg を実行してください。');
    return null;
  }

  const pool = new Pool({
    connectionString: url,
    ssl: { rejectUnauthorized: false },   // Neon等のマネージドDBはTLS必須
    max: 3,                               // 無料枠は同時接続数が少ないので絞る
  });

  const ready = pool.query(`
    CREATE TABLE IF NOT EXISTS cards (
      id         TEXT PRIMARY KEY,
      type       TEXT NOT NULL,
      title      TEXT,
      name       TEXT,
      filled     INTEGER NOT NULL,
      ip_hash    TEXT,
      handle     TEXT,
      views      INTEGER NOT NULL DEFAULT 0,
      likes      INTEGER NOT NULL DEFAULT 0,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
    ALTER TABLE cards ADD COLUMN IF NOT EXISTS handle TEXT;
    ALTER TABLE cards ADD COLUMN IF NOT EXISTS views  INTEGER NOT NULL DEFAULT 0;
    ALTER TABLE cards ADD COLUMN IF NOT EXISTS likes  INTEGER NOT NULL DEFAULT 0;
    ALTER TABLE cards ADD COLUMN IF NOT EXISTS lang   TEXT;
    ALTER TABLE cards ADD COLUMN IF NOT EXISTS born   INTEGER;
    ALTER TABLE card_items ADD COLUMN IF NOT EXISTS year INTEGER;
    ALTER TABLE card_items ADD COLUMN IF NOT EXISTS buy_url TEXT;
    CREATE TABLE IF NOT EXISTS card_items (
      card_id     TEXT NOT NULL REFERENCES cards(id) ON DELETE CASCADE,
      position    INTEGER NOT NULL,
      source      TEXT,
      external_id TEXT,
      title       TEXT,
      sub         TEXT,
      image_url   TEXT,
      PRIMARY KEY (card_id, position)
    );
    ALTER TABLE card_items ADD COLUMN IF NOT EXISTS image_url TEXT;
    CREATE INDEX IF NOT EXISTS idx_cards_type    ON cards(type);
    CREATE INDEX IF NOT EXISTS idx_cards_created ON cards(created_at);
    CREATE INDEX IF NOT EXISTS idx_cards_handle  ON cards(handle);
    CREATE INDEX IF NOT EXISTS idx_cards_pop     ON cards(likes DESC, views DESC);
    CREATE INDEX IF NOT EXISTS idx_items_ref     ON card_items(source, external_id);

    -- ランキング用の集計。カードとは寿命が違うので別に持つ。
    -- カードが90日で消えても、ここに積んだ数字は残る。
    CREATE TABLE IF NOT EXISTS item_stats (
      type        TEXT NOT NULL,
      source      TEXT NOT NULL,
      external_id TEXT NOT NULL,
      lang        TEXT NOT NULL DEFAULT '',
      age_band    INTEGER NOT NULL DEFAULT 0,
      title       TEXT,
      sub         TEXT,
      image_url   TEXT,
      year        INTEGER,
      n           INTEGER NOT NULL DEFAULT 0,
      PRIMARY KEY (type, source, external_id, lang, age_band)
    );
    CREATE INDEX IF NOT EXISTS idx_stats_n ON item_stats(type, n DESC);

    -- 外部APIの応答キャッシュ。再起動で消えないようにDBに置く。
    CREATE TABLE IF NOT EXISTS kv (
      k       TEXT PRIMARY KEY,
      v       TEXT NOT NULL,
      expires TIMESTAMPTZ NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_kv_expires ON kv(expires);
  `).catch(err => { console.error('DBの初期化に失敗:', err.message); throw err; });

  /* 起動時、集計が空でカードがあるなら、既存のカードから積み直す。
     新しい集計テーブルを入れた直後に、過去のランキングが消えないようにするため。 */
  const backfilled = ready.then(async () => {
    const r = await pool.query('SELECT COUNT(*)::int AS n FROM item_stats');
    if (r.rows[0].n > 0) return;
    const c = await pool.query('SELECT COUNT(*)::int AS n FROM card_items');
    if (!c.rows[0].n) return;
    await pool.query(`
      INSERT INTO item_stats (type, source, external_id, lang, age_band, title, sub, image_url, year, n)
      SELECT c.type, i.source, i.external_id,
             COALESCE(c.lang, ''), COALESCE(c.born, 0),
             MIN(i.title), MIN(i.sub), MIN(i.image_url), MIN(i.year), COUNT(*)::int
      FROM card_items i JOIN cards c ON c.id = i.card_id
      WHERE i.source IS NOT NULL AND i.external_id IS NOT NULL
      GROUP BY c.type, i.source, i.external_id, COALESCE(c.lang, ''), COALESCE(c.born, 0)
      ON CONFLICT DO NOTHING`);
    console.log('ランキング集計を既存のカードから作り直しました');
  }).catch(err => console.error('集計の作り直しに失敗:', err.message));

  return {
    kind: 'postgres',

    async save(card) {
      await ready;
      const id = newId();
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        await client.query(
          'INSERT INTO cards (id,type,title,name,filled,ip_hash,handle,lang,born) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)',
          [id, card.type, card.title || '', card.name || '',
           card.items.filter(Boolean).length, card.ipHash, card.handle || null, card.lang || null, card.born || null]);
        for (let i = 0; i < card.items.length; i++) {
          const it = card.items[i];
          if (!it) continue;
          await client.query(
            'INSERT INTO card_items (card_id,position,source,external_id,title,sub,image_url,year,buy_url) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)',
            [id, i, it.source || null, it.externalId || null, it.title || '', it.sub || '', it.imageUrl || null, it.year || null, it.buyUrl || null]);
        }
        // ランキング用の集計を同じトランザクションで積む
        // 前後1年も「同年代」として扱うため、10年区切りではなく生まれた年をそのまま持つ
        const band = card.born || 0;
        for (const it of card.items) {
          if (!it || !it.source || !it.externalId) continue;
          await client.query(`
            INSERT INTO item_stats (type, source, external_id, lang, age_band, title, sub, image_url, year, n)
            VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,1)
            ON CONFLICT (type, source, external_id, lang, age_band)
            DO UPDATE SET n = item_stats.n + 1,
                          image_url = COALESCE(item_stats.image_url, EXCLUDED.image_url)`,
            [card.type, it.source, it.externalId, card.lang || '', band,
             it.title || '', it.sub || '', it.imageUrl || null, it.year || null]);
        }
        await client.query('COMMIT');
      } catch (e) {
        await client.query('ROLLBACK').catch(() => {});
        throw e;
      } finally {
        client.release();
      }
      return id;
    },

    async stats() {
      await ready;
      const [total, today, byType] = await Promise.all([
        pool.query('SELECT COUNT(*)::int AS n FROM cards'),
        pool.query("SELECT COUNT(*)::int AS n FROM cards WHERE created_at > now() - interval '24 hours'"),
        pool.query('SELECT type, COUNT(*)::int AS n FROM cards GROUP BY type'),
      ]);
      const map = {};
      byType.rows.forEach(r => { map[r.type] = r.n; });
      return { total: total.rows[0].n, today: today.rows[0].n, byType: map };
    },

    /* ランキングは item_stats から読む。カードが消えても数字が残る。 */
    async top({ type = null, notType = null, lang = null, decade = null, ageBand = null, limit = 9 } = {}) {
      await ready; await backfilled;
      const where = [];
      const args = [];
      if (type)   { args.push(type);   where.push(`type = $${args.length}`); }
      // 特定の種類を集計から外す（英語では書籍を出さない、など）
      if (notType){ args.push(notType); where.push(`type <> $${args.length}`); }
      if (lang)   { args.push(lang);   where.push(`lang = $${args.length}`); }
      if (decade) { args.push(decade); where.push(`year >= $${args.length} AND year < $${args.length} + 10`); }
      if (ageBand) {
        // 「作った人の生まれた年」で絞る。作品の発売年（year）とは別。
        // 前後1年も同年代として扱う（1999年生まれなら1998〜2000年生まれ）
        args.push(ageBand - 1, ageBand + 1);
        where.push(`age_band BETWEEN $${args.length - 1} AND $${args.length}`);
      }
      args.push(limit);
      const r = await pool.query(`
        SELECT source, external_id,
               MIN(title) AS title, MIN(sub) AS sub,
               MIN(image_url) AS image_url, MIN(year) AS year,
               SUM(n)::int AS n
        FROM item_stats
        ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
        GROUP BY source, external_id
        ORDER BY n DESC LIMIT $${args.length}`, args);
      return r.rows;
    },

    /* 外部APIの応答キャッシュ */
    async cacheGet(key) {
      await ready;
      const r = await pool.query('SELECT v FROM kv WHERE k = $1 AND expires > now()', [key]);
      if (!r.rows.length) return null;
      try { return JSON.parse(r.rows[0].v); } catch { return null; }
    },
    async cacheSet(key, value, ttlMs) {
      await ready;
      await pool.query(
        `INSERT INTO kv (k, v, expires) VALUES ($1, $2, now() + ($3 || ' milliseconds')::interval)
         ON CONFLICT (k) DO UPDATE SET v = EXCLUDED.v, expires = EXCLUDED.expires`,
        [key, JSON.stringify(value), String(ttlMs)]);
    },
    async cacheSweep() {
      await ready;
      const r = await pool.query('DELETE FROM kv WHERE expires < now()');
      return r.rowCount || 0;
    },

    async countByIP(ipHash, sinceMs) {
      await ready;
      const r = await pool.query(
        'SELECT COUNT(*)::int AS n FROM cards WHERE ip_hash = $1 AND created_at > now() - ($2 || \' milliseconds\')::interval',
        [ipHash, String(sinceMs)]);
      return r.rows[0].n;
    },

    async get(id) {
      await ready;
      const c = await pool.query('SELECT * FROM cards WHERE id = $1', [id]);
      if (!c.rows.length) return null;
      const items = await pool.query(
        'SELECT * FROM card_items WHERE card_id = $1 ORDER BY position', [id]);
      return { ...c.rows[0], items: items.rows };
    },

    /* n をまとめて足せる。拡散時に1表示=1書き込みにするとDBが休めないため、
       server.js 側で数分ぶんを溜めてから呼ぶ。 */
    async view(id, n = 1) {
      await ready;
      await pool.query('UPDATE cards SET views = views + $2 WHERE id = $1', [id, n]);
    },

    async like(id) {
      await ready;
      const r = await pool.query(
        'UPDATE cards SET likes = likes + 1 WHERE id = $1 RETURNING likes', [id]);
      return r.rows[0]?.likes ?? null;
    },

    /** 一覧。sort は 'new'（最新）か 'hot'（人気） */
    async list({ type = null, notType = null, sort = 'new', handle = null, q: kw = null, limit = 24, offset = 0 } = {}) {
      await ready;
      const where = ['filled > 0'];
      const args = [];
      if (type)   { args.push(type);   where.push(`type = $${args.length}`); }
      if (notType){ args.push(notType); where.push(`type <> $${args.length}`); }
      if (handle) { args.push(handle); where.push(`handle = $${args.length}`); }
      if (kw) {
        args.push('%' + kw + '%');
        where.push(`(title ILIKE $${args.length} OR name ILIKE $${args.length}
          OR id IN (SELECT card_id FROM card_items WHERE title ILIKE $${args.length}))`);
      }
      // 人気は「いいね重視、閲覧も加味、新しいものを少し優遇」
      const order = sort === 'hot'
        ? `(likes * 3 + views) / (1 + EXTRACT(EPOCH FROM (now() - created_at)) / 86400) DESC, created_at DESC`
        : 'created_at DESC';
      args.push(limit, offset);
      const r = await pool.query(`
        SELECT id, type, title, name, handle, views, likes, created_at
        FROM cards WHERE ${where.join(' AND ')}
        ORDER BY ${order} LIMIT $${args.length - 1} OFFSET $${args.length}`, args);
      if (!r.rows.length) return [];
      // 一覧に9マスの見た目を出すため、各カードの画像URLを添える
      const ids = r.rows.map(x => x.id);
      const th = await pool.query(
        'SELECT card_id, position, image_url FROM card_items WHERE card_id = ANY($1) ORDER BY position',
        [ids]);
      const map = {};
      th.rows.forEach(i => { (map[i.card_id] = map[i.card_id] || [])[i.position] = i.image_url; });
      return r.rows.map(c => ({ ...c, thumbs: (map[c.id] || []).slice(0, 9) }));
    },

    /** 誰にも見られないまま古くなったものだけ消す */
    async cleanup(days = 90) {
      await ready;
      const r = await pool.query(`
        DELETE FROM cards
        WHERE views = 0 AND likes = 0
          AND created_at < now() - ($1 || ' days')::interval
        RETURNING id`, [String(days)]);
      return r.rowCount;
    },
  };
}

/* ================================================================== *
 * SQLite（あれば使う）
 * ================================================================== */
function openSqlite() {
  let DatabaseSync;
  try { ({ DatabaseSync } = require('node:sqlite')); }
  catch { return null; }

  let db;
  try { db = new DatabaseSync(path.join(DATA_DIR, 'nine.db')); }
  catch { return null; }

  db.exec(`
    CREATE TABLE IF NOT EXISTS cards (
      id         TEXT PRIMARY KEY,
      type       TEXT NOT NULL,
      title      TEXT,
      name       TEXT,
      filled     INTEGER NOT NULL,
      ip_hash    TEXT,
      handle     TEXT,
      views      INTEGER NOT NULL DEFAULT 0,
      likes      INTEGER NOT NULL DEFAULT 0,
      lang       TEXT,
      born       INTEGER,
      created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS card_items (
      card_id     TEXT NOT NULL,
      position    INTEGER NOT NULL,
      source      TEXT,
      external_id TEXT,
      title       TEXT,
      sub         TEXT,
      image_url   TEXT,
      year        INTEGER,
      buy_url     TEXT,
      PRIMARY KEY (card_id, position)
    );
    CREATE INDEX IF NOT EXISTS idx_cards_type ON cards(type);
    CREATE INDEX IF NOT EXISTS idx_items_ref  ON card_items(source, external_id);

    -- ランキング用の集計。カードとは寿命が違うので別に持つ
    CREATE TABLE IF NOT EXISTS item_stats (
      type        TEXT NOT NULL,
      source      TEXT NOT NULL,
      external_id TEXT NOT NULL,
      lang        TEXT NOT NULL DEFAULT '',
      age_band    INTEGER NOT NULL DEFAULT 0,
      title       TEXT, sub TEXT, image_url TEXT, year INTEGER,
      n           INTEGER NOT NULL DEFAULT 0,
      PRIMARY KEY (type, source, external_id, lang, age_band)
    );
    CREATE INDEX IF NOT EXISTS idx_stats_n ON item_stats(type, n DESC);

    -- 外部APIの応答キャッシュ
    CREATE TABLE IF NOT EXISTS kv (
      k TEXT PRIMARY KEY, v TEXT NOT NULL, expires INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_kv_expires ON kv(expires);
  `);

  const insCard = db.prepare(
    'INSERT INTO cards (id,type,title,name,filled,ip_hash,handle,lang,born,created_at) VALUES (?,?,?,?,?,?,?,?,?,?)');
  // 既存のDBに後から列を足す場合の保険
  try { db.exec('ALTER TABLE card_items ADD COLUMN image_url TEXT'); } catch {}
  try { db.exec('ALTER TABLE cards ADD COLUMN handle TEXT'); } catch {}
  try { db.exec('ALTER TABLE cards ADD COLUMN views INTEGER NOT NULL DEFAULT 0'); } catch {}
  try { db.exec('ALTER TABLE cards ADD COLUMN likes INTEGER NOT NULL DEFAULT 0'); } catch {}
  try { db.exec('ALTER TABLE cards ADD COLUMN lang TEXT'); } catch {}
  try { db.exec('ALTER TABLE cards ADD COLUMN born INTEGER'); } catch {}
  try { db.exec('ALTER TABLE card_items ADD COLUMN year INTEGER'); } catch {}
  try { db.exec('ALTER TABLE card_items ADD COLUMN buy_url TEXT'); } catch {}

  const insItem = db.prepare(
    'INSERT INTO card_items (card_id,position,source,external_id,title,sub,image_url,year,buy_url) VALUES (?,?,?,?,?,?,?,?,?)');
  const qTotal   = db.prepare('SELECT COUNT(*) AS n FROM cards');
  const qByType  = db.prepare('SELECT type, COUNT(*) AS n FROM cards GROUP BY type');
  const qRecent  = db.prepare(
    "SELECT COUNT(*) AS n FROM cards WHERE created_at > ?");
  const qTop     = db.prepare(`
    SELECT source, external_id, title, sub, COUNT(*) AS n
    FROM card_items
    WHERE card_id IN (SELECT id FROM cards WHERE type = ?)
      AND external_id IS NOT NULL
    GROUP BY source, external_id
    ORDER BY n DESC LIMIT ?`);
  const qIpCount = db.prepare(
    'SELECT COUNT(*) AS n FROM cards WHERE ip_hash = ? AND created_at > ?');
  const insStat = db.prepare(`
    INSERT INTO item_stats (type,source,external_id,lang,age_band,title,sub,image_url,year,n)
    VALUES (?,?,?,?,?,?,?,?,?,1)
    ON CONFLICT (type,source,external_id,lang,age_band)
    DO UPDATE SET n = n + 1, image_url = COALESCE(item_stats.image_url, excluded.image_url)`);
  const qKvGet = db.prepare('SELECT v FROM kv WHERE k = ? AND expires > ?');
  const qKvSet = db.prepare(
    'INSERT INTO kv (k,v,expires) VALUES (?,?,?) ON CONFLICT (k) DO UPDATE SET v = excluded.v, expires = excluded.expires');

  /* 集計が空でカードがあるなら、既存のカードから積み直す */
  try {
    if (!db.prepare('SELECT COUNT(*) AS n FROM item_stats').get().n
        && db.prepare('SELECT COUNT(*) AS n FROM card_items').get().n) {
      db.exec(`
        INSERT OR IGNORE INTO item_stats (type,source,external_id,lang,age_band,title,sub,image_url,year,n)
        SELECT c.type, i.source, i.external_id,
               COALESCE(c.lang,''), COALESCE(c.born, 0),
               MIN(i.title), MIN(i.sub), MIN(i.image_url), MIN(i.year), COUNT(*)
        FROM card_items i JOIN cards c ON c.id = i.card_id
        WHERE i.source IS NOT NULL AND i.external_id IS NOT NULL
        GROUP BY c.type, i.source, i.external_id, COALESCE(c.lang,''), COALESCE(c.born, 0)`);
      console.log('ランキング集計を既存のカードから作り直しました');
    }
  } catch (e) { console.error('集計の作り直しに失敗:', e.message); }

  return {
    kind: 'sqlite',
    save(card) {
      const id = newId();
      const now = new Date().toISOString();
      insCard.run(id, card.type, card.title || '', card.name || '',
                  card.items.filter(Boolean).length, card.ipHash, card.handle || null, card.lang || null, card.born || null, now);
      // 前後1年も「同年代」として扱うため、10年区切りではなく生まれた年をそのまま持つ
      const band = card.born || 0;
      card.items.forEach((it, i) => {
        if (!it) return;
        insItem.run(id, i, it.source || null, it.externalId || null,
                    it.title || '', it.sub || '', it.imageUrl || null, it.year || null, it.buyUrl || null);
        if (it.source && it.externalId) {
          insStat.run(card.type, it.source, it.externalId, card.lang || '', band,
                      it.title || '', it.sub || '', it.imageUrl || null, it.year || null);
        }
      });
      return id;
    },
    stats() {
      const byType = {};
      for (const r of qByType.all()) byType[r.type] = r.n;
      const since = new Date(Date.now() - 24 * 3600e3).toISOString();
      return { total: qTotal.get().n, today: qRecent.get(since).n, byType };
    },
    /* ランキングは item_stats から読む。カードが消えても数字が残る */
    top({ type = null, notType = null, lang = null, decade = null, ageBand = null, limit = 9 } = {}) {
      const where = [];
      const args = [];
      if (type)   { where.push('type = ?');  args.push(type); }
      if (notType){ where.push('type <> ?'); args.push(notType); }
      if (lang)   { where.push('lang = ?');  args.push(lang); }
      if (decade) { where.push('year >= ? AND year < ? + 10'); args.push(decade, decade); }
      // 前後1年も同年代として扱う
      if (ageBand){ where.push('age_band BETWEEN ? AND ?'); args.push(ageBand - 1, ageBand + 1); }
      args.push(limit);
      return db.prepare(`
        SELECT source, external_id,
               MIN(title) AS title, MIN(sub) AS sub,
               MIN(image_url) AS image_url, MIN(year) AS year,
               SUM(n) AS n
        FROM item_stats
        ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
        GROUP BY source, external_id
        ORDER BY n DESC LIMIT ?`).all(...args);
    },

    /* 外部APIの応答キャッシュ */
    cacheGet(key) {
      const r = qKvGet.get(key, Date.now());
      if (!r) return null;
      try { return JSON.parse(r.v); } catch { return null; }
    },
    cacheSet(key, value, ttlMs) {
      qKvSet.run(key, JSON.stringify(value), Date.now() + ttlMs);
    },
    cacheSweep() {
      const r = db.prepare('DELETE FROM kv WHERE expires < ?').run(Date.now());
      return r.changes || 0;
    },
    countByIP(ipHash, sinceMs) {
      return qIpCount.get(ipHash, new Date(Date.now() - sinceMs).toISOString()).n;
    },

    get(id) {
      const c = db.prepare('SELECT * FROM cards WHERE id = ?').get(id);
      if (!c) return null;
      const items = db.prepare('SELECT * FROM card_items WHERE card_id = ? ORDER BY position').all(id);
      return { ...c, items };
    },

    view(id, n = 1) { db.prepare('UPDATE cards SET views = views + ? WHERE id = ?').run(n, id); },

    like(id) {
      db.prepare('UPDATE cards SET likes = likes + 1 WHERE id = ?').run(id);
      return db.prepare('SELECT likes FROM cards WHERE id = ?').get(id)?.likes ?? null;
    },

    list({ type = null, notType = null, sort = 'new', handle = null, q: kw = null, limit = 24, offset = 0 } = {}) {
      const where = ['filled > 0'];
      const args = [];
      if (type)   { where.push('type = ?');   args.push(type); }
      if (notType){ where.push('type <> ?');  args.push(notType); }
      if (handle) { where.push('handle = ?'); args.push(handle); }
      if (kw) {
        where.push(`(title LIKE ? OR name LIKE ?
          OR id IN (SELECT card_id FROM card_items WHERE title LIKE ?))`);
        args.push('%' + kw + '%', '%' + kw + '%', '%' + kw + '%');
      }
      const order = sort === 'hot'
        ? `(likes * 3 + views) * 1.0 /
           (1 + (julianday('now') - julianday(created_at))) DESC, created_at DESC`
        : 'created_at DESC';
      args.push(limit, offset);
      const rows = db.prepare(`
        SELECT id, type, title, name, handle, views, likes, created_at
        FROM cards WHERE ${where.join(' AND ')}
        ORDER BY ${order} LIMIT ? OFFSET ?`).all(...args);
      const q2 = db.prepare('SELECT position, image_url FROM card_items WHERE card_id = ? ORDER BY position');
      return rows.map(c => {
        const t = [];
        q2.all(c.id).forEach(i => { t[i.position] = i.image_url; });
        return { ...c, thumbs: t.slice(0, 9) };
      });
    },

    cleanup(days = 90) {
      const cutoff = new Date(Date.now() - days * 86400e3).toISOString();
      const r = db.prepare(
        'DELETE FROM cards WHERE views = 0 AND likes = 0 AND created_at < ?').run(cutoff);
      db.exec('DELETE FROM card_items WHERE card_id NOT IN (SELECT id FROM cards)');
      return r.changes;
    },
  };
}

/* ================================================================== *
 * JSONフォールバック
 * ================================================================== */
function openJSON() {
  const file = path.join(DATA_DIR, 'nine.json');
  let state = { cards: [], items: [], stats: {}, kv: {} };
  try { state = { stats: {}, kv: {}, ...JSON.parse(fs.readFileSync(file, 'utf8')) }; } catch {}
  if (!state.stats) state.stats = {};
  if (!state.kv) state.kv = {};

  /* 集計が空でカードがあるなら、既存のカードから積み直す */
  if (!Object.keys(state.stats).length && state.items.length) {
    const byCard = new Map(state.cards.map(c => [c.id, c]));
    state.items.forEach(it => {
      const c = byCard.get(it.card_id);
      if (!c || !it.source || !it.external_id) return;
      const band = c.born || 0;
      const k = [c.type, it.source, it.external_id, c.lang || '', band].join('\u0000');
      const cur = state.stats[k] || { type: c.type, source: it.source, external_id: it.external_id,
        lang: c.lang || '', age_band: band, title: it.title, sub: it.sub,
        image_url: it.image_url, year: it.year, n: 0 };
      cur.n++; state.stats[k] = cur;
    });
    console.log('ランキング集計を既存のカードから作り直しました');
  }

  let timer = null;
  const flush = () => {
    clearTimeout(timer);
    timer = setTimeout(() => {
      fs.writeFile(file, JSON.stringify(state), err => err && console.error(err));
    }, 400);
  };

  return {
    kind: 'json',
    save(card) {
      const id = newId();
      state.cards.push({
        id, type: card.type, title: card.title || '', name: card.name || '',
        filled: card.items.filter(Boolean).length,
        ip_hash: card.ipHash, handle: card.handle || null,
        views: 0, likes: 0, created_at: new Date().toISOString(),
      });
      // 前後1年も「同年代」として扱うため、10年区切りではなく生まれた年をそのまま持つ
      const band = card.born || 0;
      card.items.forEach((it, i) => {
        if (!it) return;
        state.items.push({
          card_id: id, position: i, source: it.source || null,
          external_id: it.externalId || null, title: it.title || '', sub: it.sub || '',
          image_url: it.imageUrl || null, year: it.year || null, buy_url: it.buyUrl || null,
        });
        if (!it.source || !it.externalId) return;
        const k = [card.type, it.source, it.externalId, card.lang || '', band].join('\u0000');
        const cur = state.stats[k] || { type: card.type, source: it.source,
          external_id: it.externalId, lang: card.lang || '', age_band: band,
          title: it.title || '', sub: it.sub || '', image_url: it.imageUrl || null,
          year: it.year || null, n: 0 };
        cur.n++;
        if (!cur.image_url) cur.image_url = it.imageUrl || null;
        state.stats[k] = cur;
      });
      flush();
      return id;
    },
    stats() {
      const byType = {};
      state.cards.forEach(c => { byType[c.type] = (byType[c.type] || 0) + 1; });
      const since = Date.now() - 24 * 3600e3;
      const today = state.cards.filter(c => new Date(c.created_at).getTime() > since).length;
      return { total: state.cards.length, today, byType };
    },
    /* ランキングは集計から読む。カードが消えても数字が残る */
    top({ type = null, notType = null, lang = null, decade = null, ageBand = null, limit = 9 } = {}) {
      const bucket = new Map();
      Object.values(state.stats).forEach(r => {
        if (type && r.type !== type) return;
        if (notType && r.type === notType) return;
        if (lang && r.lang !== lang) return;
        if (ageBand && Math.abs((r.age_band || 0) - ageBand) > 1) return;
        if (decade && !(r.year >= decade && r.year < decade + 10)) return;
        const k = `${r.source}:${r.external_id}`;
        const cur = bucket.get(k) || { source: r.source, external_id: r.external_id,
          title: r.title, sub: r.sub, image_url: r.image_url, year: r.year, n: 0 };
        cur.n += r.n;
        if (!cur.image_url) cur.image_url = r.image_url;
        bucket.set(k, cur);
      });
      return [...bucket.values()].sort((a, b) => b.n - a.n).slice(0, limit);
    },

    /* 外部APIの応答キャッシュ */
    cacheGet(key) {
      const hit = state.kv[key];
      if (!hit) return null;
      if (Date.now() > hit.e) { delete state.kv[key]; return null; }
      return hit.v;
    },
    cacheSet(key, value, ttlMs) {
      state.kv[key] = { v: value, e: Date.now() + ttlMs };
      flush();
    },
    cacheSweep() {
      const now = Date.now();
      let n = 0;
      for (const [k, v] of Object.entries(state.kv)) if (now > v.e) { delete state.kv[k]; n++; }
      if (n) flush();
      return n;
    },
    countByIP(ipHash, sinceMs) {
      const since = Date.now() - sinceMs;
      return state.cards.filter(c => c.ip_hash === ipHash && new Date(c.created_at).getTime() > since).length;
    },

    get(id) {
      const c = state.cards.find(x => x.id === id);
      if (!c) return null;
      return { ...c, items: state.items.filter(i => i.card_id === id).sort((a, b) => a.position - b.position) };
    },

    view(id, n = 1) {
      const c = state.cards.find(x => x.id === id);
      if (c) { c.views = (c.views || 0) + n; flush(); }
    },

    like(id) {
      const c = state.cards.find(x => x.id === id);
      if (!c) return null;
      c.likes = (c.likes || 0) + 1; flush();
      return c.likes;
    },

    list({ type = null, notType = null, sort = 'new', handle = null, q: kw = null, limit = 24, offset = 0 } = {}) {
      const needle = (kw || '').toLowerCase();
      let rows = state.cards.filter(c => {
        if (!c.filled) return false;
        if (type && c.type !== type) return false;
        if (notType && c.type === notType) return false;
        if (handle && c.handle !== handle) return false;
        if (needle) {
          const inItems = state.items.some(i =>
            i.card_id === c.id && (i.title || '').toLowerCase().includes(needle));
          if (!(c.title || '').toLowerCase().includes(needle)
            && !(c.name || '').toLowerCase().includes(needle) && !inItems) return false;
        }
        return true;
      });
      const score = c => ((c.likes || 0) * 3 + (c.views || 0)) /
        (1 + (Date.now() - new Date(c.created_at).getTime()) / 86400e3);
      rows.sort(sort === 'hot'
        ? (a, b) => score(b) - score(a)
        : (a, b) => b.created_at.localeCompare(a.created_at));
      return rows.slice(offset, offset + limit).map(c => {
        const t = [];
        state.items.filter(i => i.card_id === c.id)
          .forEach(i => { t[i.position] = i.image_url; });
        return { ...c, thumbs: t.slice(0, 9) };
      });
    },

    cleanup(days = 90) {
      const cutoff = Date.now() - days * 86400e3;
      const before = state.cards.length;
      const keep = new Set();
      state.cards = state.cards.filter(c => {
        const alive = (c.views || 0) > 0 || (c.likes || 0) > 0
          || new Date(c.created_at).getTime() >= cutoff;
        if (alive) keep.add(c.id);
        return alive;
      });
      state.items = state.items.filter(i => keep.has(i.card_id));
      flush();
      return before - state.cards.length;
    },
  };
}

// 優先順位: 外部DB → SQLite → JSON
const store = openPostgres() || openSqlite() || openJSON();
const WHERE = {
  postgres: 'PostgreSQL (DATABASE_URL)',
  sqlite:   'SQLite (data/nine.db)',
  json:     'JSON (data/nine.json)',
};
console.log(`保存先: ${WHERE[store.kind]}`);
if (store.kind !== 'postgres' && process.env.RENDER) {
  console.warn('警告: Renderの無料枠はファイルが揮発します。DATABASE_URL を設定してください。');
}

module.exports = { store, hashIP };
