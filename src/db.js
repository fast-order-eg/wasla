import { DatabaseSync } from 'node:sqlite';
import { mkdir } from 'node:fs/promises';
import { dirname } from 'node:path';

export const COLLECTIONS = new Set(['products', 'channels', 'conversations', 'messages', 'orders', 'publishing_tasks', 'events', 'workers', 'settings', 'groups']);
function collectionName(value) {
  if (!COLLECTIONS.has(value)) throw new Error('Unknown collection');
  return value;
}
function recordJson(record) {
  if (!record || typeof record.id !== 'string' || !record.id || record.id.length > 191) throw new Error('Record needs a valid id');
  return JSON.stringify(record);
}
function serialQueue() {
  let pending = Promise.resolve();
  return action => {
    const next = pending.then(action);
    pending = next.catch(() => {});
    return next;
  };
}

export async function createStore({ driver = 'sqlite', filename = './data/commerce.sqlite', mysqlUrl } = {}) {
  if (driver === 'mysql') return createMysqlStore(mysqlUrl);
  if (driver !== 'sqlite') throw new Error('Unsupported database driver');
  if (filename !== ':memory:') await mkdir(dirname(filename), { recursive: true });
  const db = new DatabaseSync(filename);
  db.exec('PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000;');
  db.exec('CREATE TABLE IF NOT EXISTS app_records (collection TEXT NOT NULL, id TEXT NOT NULL, payload TEXT NOT NULL CHECK(json_valid(payload)), updated_at TEXT NOT NULL, PRIMARY KEY(collection,id))');
  const enqueue = serialQueue();
  const direct = {
    async all(collection) {
      return db.prepare('SELECT payload FROM app_records WHERE collection = ? ORDER BY updated_at, id').all(collectionName(collection)).map(row => JSON.parse(row.payload));
    },
    async get(collection, id) {
      const row = db.prepare('SELECT payload FROM app_records WHERE collection = ? AND id = ?').get(collectionName(collection), String(id));
      return row ? JSON.parse(row.payload) : null;
    },
    async put(collection, record) {
      const payload = recordJson(record);
      db.prepare('INSERT INTO app_records (collection,id,payload,updated_at) VALUES (?,?,?,?) ON CONFLICT(collection,id) DO UPDATE SET payload=excluded.payload,updated_at=excluded.updated_at').run(collectionName(collection), record.id, payload, new Date().toISOString());
      return JSON.parse(payload);
    },
    async remove(collection, id) {
      db.prepare('DELETE FROM app_records WHERE collection = ? AND id = ?').run(collectionName(collection), String(id));
    }
  };
  const store = Object.fromEntries(Object.entries(direct).map(([name, fn]) => [name, (...args) => enqueue(() => fn(...args))]));
  store.transaction = callback => enqueue(async () => {
    db.exec('BEGIN IMMEDIATE');
    try { const result = await callback(direct); db.exec('COMMIT'); return result; }
    catch (error) { db.exec('ROLLBACK'); throw error; }
  });
  store.close = () => enqueue(() => db.close());
  return store;
}

async function createMysqlStore(mysqlUrl) {
  if (!mysqlUrl) throw new Error('MYSQL_URL is required');
  const { createPool } = await import('mysql2/promise');
  const pool = createPool(mysqlUrl);
  await pool.query('CREATE TABLE IF NOT EXISTS app_records (collection VARCHAR(64) NOT NULL, id VARCHAR(191) NOT NULL, payload JSON NOT NULL, updated_at VARCHAR(32) NOT NULL, PRIMARY KEY(collection,id), INDEX records_updated(collection,updated_at)) ENGINE=InnoDB CHARACTER SET utf8mb4 COLLATE utf8mb4_bin');
  const parse = payload => typeof payload === 'string' ? JSON.parse(payload) : payload;
  const directFor = connection => ({
    async all(collection) {
      const [rows] = await connection.execute('SELECT payload FROM app_records WHERE collection=? ORDER BY updated_at,id', [collectionName(collection)]);
      return rows.map(row => parse(row.payload));
    },
    async get(collection, id) {
      const [rows] = await connection.execute('SELECT payload FROM app_records WHERE collection=? AND id=?', [collectionName(collection), String(id)]);
      return rows[0] ? parse(rows[0].payload) : null;
    },
    async put(collection, record) {
      const payload = recordJson(record);
      await connection.execute('INSERT INTO app_records(collection,id,payload,updated_at) VALUES(?,?,?,?) ON DUPLICATE KEY UPDATE payload=VALUES(payload),updated_at=VALUES(updated_at)', [collectionName(collection), record.id, payload, new Date().toISOString()]);
      return JSON.parse(payload);
    },
    async remove(collection, id) {
      await connection.execute('DELETE FROM app_records WHERE collection=? AND id=?', [collectionName(collection), String(id)]);
    }
  });
  const locked = async (callback, transactional = false) => {
    const connection = await pool.getConnection();
    let acquired = false;
    try {
      const [[result]] = await connection.query("SELECT GET_LOCK(SHA2(CONCAT('commerce:', DATABASE()), 256), 15) AS acquired");
      acquired = Number(result.acquired) === 1;
      if (!acquired) throw new Error('Database is busy; retry later');
      if (transactional) await connection.beginTransaction();
      const resultValue = await callback(directFor(connection));
      if (transactional) await connection.commit();
      return resultValue;
    } catch (error) {
      if (transactional && acquired) await connection.rollback();
      throw error;
    } finally {
      try { if (acquired) await connection.query("SELECT RELEASE_LOCK(SHA2(CONCAT('commerce:', DATABASE()), 256))"); }
      finally { connection.release(); }
    }
  };
  const store = Object.fromEntries(['all', 'get', 'put', 'remove'].map(name => [name, (...args) => locked(tx => tx[name](...args))]));
  store.transaction = callback => locked(callback, true);
  store.close = () => pool.end();
  return store;
}
