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
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
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
          'INSERT INTO cards (id,type,title,name,filled,ip_hash) VALUES ($1,$2,$3,$4,$5,$6)',
          [id, card.type, card.title || '', card.name || '',
           card.items.filter(Boolean).length, card.ipHash]);
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
    'INSERT INTO cards (id,type,title,name,filled,ip_hash,created_at) VALUES (?,?,?,?,?,?,?)');
  // 既存のDBに後から列を足す場合の保険
  try { db.exec('ALTER TABLE card_items ADD COLUMN image_url TEXT'); } catch {}

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
                  card.items.filter(Boolean).length, card.ipHash, now);
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
        ip_hash: card.ipHash, created_at: new Date().toISOString(),
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
