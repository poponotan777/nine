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
  `).catch(err => { console.error('DBの初期化に失敗:', err.message); throw err; });

  return {
    kind: 'postgres',

    async save(card) {
      await ready;
      const id = newId();
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        await client.query(
          'INSERT INTO cards (id,type,title,name,filled,ip_hash,handle) VALUES ($1,$2,$3,$4,$5,$6,$7)',
          [id, card.type, card.title || '', card.name || '',
           card.items.filter(Boolean).length, card.ipHash, card.handle || null]);
        for (let i = 0; i < card.items.length; i++) {
          const it = card.items[i];
          if (!it) continue;
          await client.query(
            'INSERT INTO card_items (card_id,position,source,external_id,title,sub,image_url) VALUES ($1,$2,$3,$4,$5,$6,$7)',
            [id, i, it.source || null, it.externalId || null, it.title || '', it.sub || '', it.imageUrl || null]);
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

    async top(type, limit = 9) {
      await ready;
      const r = await pool.query(`
        SELECT i.source, i.external_id, MIN(i.title) AS title, MIN(i.sub) AS sub, COUNT(*)::int AS n
        FROM card_items i JOIN cards c ON c.id = i.card_id
        WHERE c.type = $1 AND i.external_id IS NOT NULL
        GROUP BY i.source, i.external_id
        ORDER BY n DESC LIMIT $2`, [type, limit]);
      return r.rows;
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

    async view(id) {
      await ready;
      await pool.query('UPDATE cards SET views = views + 1 WHERE id = $1', [id]);
    },

    async like(id) {
      await ready;
      const r = await pool.query(
        'UPDATE cards SET likes = likes + 1 WHERE id = $1 RETURNING likes', [id]);
      return r.rows[0]?.likes ?? null;
    },

    /** 一覧。sort は 'new'（最新）か 'hot'（人気） */
    async list({ type = null, sort = 'new', handle = null, q: kw = null, limit = 24, offset = 0 } = {}) {
      await ready;
      const where = ['filled > 0'];
      const args = [];
      if (type)   { args.push(type);   where.push(`type = $${args.length}`); }
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
      return r.rows;
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
      PRIMARY KEY (card_id, position)
    );
    CREATE INDEX IF NOT EXISTS idx_cards_type ON cards(type);
    CREATE INDEX IF NOT EXISTS idx_items_ref  ON card_items(source, external_id);
  `);

  const insCard = db.prepare(
    'INSERT INTO cards (id,type,title,name,filled,ip_hash,handle,created_at) VALUES (?,?,?,?,?,?,?,?)');
  // 既存のDBに後から列を足す場合の保険
  try { db.exec('ALTER TABLE card_items ADD COLUMN image_url TEXT'); } catch {}
  try { db.exec('ALTER TABLE cards ADD COLUMN handle TEXT'); } catch {}
  try { db.exec('ALTER TABLE cards ADD COLUMN views INTEGER NOT NULL DEFAULT 0'); } catch {}
  try { db.exec('ALTER TABLE cards ADD COLUMN likes INTEGER NOT NULL DEFAULT 0'); } catch {}

  const insItem = db.prepare(
    'INSERT INTO card_items (card_id,position,source,external_id,title,sub,image_url) VALUES (?,?,?,?,?,?,?)');
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

  return {
    kind: 'sqlite',
    save(card) {
      const id = newId();
      const now = new Date().toISOString();
      insCard.run(id, card.type, card.title || '', card.name || '',
                  card.items.filter(Boolean).length, card.ipHash, card.handle || null, now);
      card.items.forEach((it, i) => {
        if (!it) return;
        insItem.run(id, i, it.source || null, it.externalId || null,
                    it.title || '', it.sub || '', it.imageUrl || null);
      });
      return id;
    },
    stats() {
      const byType = {};
      for (const r of qByType.all()) byType[r.type] = r.n;
      const since = new Date(Date.now() - 24 * 3600e3).toISOString();
      return { total: qTotal.get().n, today: qRecent.get(since).n, byType };
    },
    top(type, limit = 9) { return qTop.all(type, limit); },
    countByIP(ipHash, sinceMs) {
      return qIpCount.get(ipHash, new Date(Date.now() - sinceMs).toISOString()).n;
    },

    get(id) {
      const c = db.prepare('SELECT * FROM cards WHERE id = ?').get(id);
      if (!c) return null;
      const items = db.prepare('SELECT * FROM card_items WHERE card_id = ? ORDER BY position').all(id);
      return { ...c, items };
    },

    view(id) { db.prepare('UPDATE cards SET views = views + 1 WHERE id = ?').run(id); },

    like(id) {
      db.prepare('UPDATE cards SET likes = likes + 1 WHERE id = ?').run(id);
      return db.prepare('SELECT likes FROM cards WHERE id = ?').get(id)?.likes ?? null;
    },

    list({ type = null, sort = 'new', handle = null, q: kw = null, limit = 24, offset = 0 } = {}) {
      const where = ['filled > 0'];
      const args = [];
      if (type)   { where.push('type = ?');   args.push(type); }
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
      return db.prepare(`
        SELECT id, type, title, name, handle, views, likes, created_at
        FROM cards WHERE ${where.join(' AND ')}
        ORDER BY ${order} LIMIT ? OFFSET ?`).all(...args);
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
  let state = { cards: [], items: [] };
  try { state = JSON.parse(fs.readFileSync(file, 'utf8')); } catch {}

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
      card.items.forEach((it, i) => {
        if (!it) return;
        state.items.push({
          card_id: id, position: i, source: it.source || null,
          external_id: it.externalId || null, title: it.title || '', sub: it.sub || '',
          image_url: it.imageUrl || null,
        });
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
    top(type, limit = 9) {
      const ids = new Set(state.cards.filter(c => c.type === type).map(c => c.id));
      const bucket = new Map();
      state.items.forEach(it => {
        if (!ids.has(it.card_id) || !it.external_id) return;
        const k = `${it.source}:${it.external_id}`;
        const cur = bucket.get(k) || { source: it.source, external_id: it.external_id, title: it.title, sub: it.sub, n: 0 };
        cur.n++; bucket.set(k, cur);
      });
      return [...bucket.values()].sort((a, b) => b.n - a.n).slice(0, limit);
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

    view(id) {
      const c = state.cards.find(x => x.id === id);
      if (c) { c.views = (c.views || 0) + 1; flush(); }
    },

    like(id) {
      const c = state.cards.find(x => x.id === id);
      if (!c) return null;
      c.likes = (c.likes || 0) + 1; flush();
      return c.likes;
    },

    list({ type = null, sort = 'new', handle = null, q: kw = null, limit = 24, offset = 0 } = {}) {
      const needle = (kw || '').toLowerCase();
      let rows = state.cards.filter(c => {
        if (!c.filled) return false;
        if (type && c.type !== type) return false;
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
      return rows.slice(offset, offset + limit);
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
