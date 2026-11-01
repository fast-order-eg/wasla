import { DatabaseSync } from 'node:sqlite';
import { access, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export async function backupSqlite(source, destination) {
  const from = path.resolve(source), to = path.resolve(destination);
  if (from === to) throw new Error('Backup destination must differ from source.');
  await access(from);
  try { await access(to); throw new Error('Backup destination already exists.'); }
  catch (error) { if (error.code !== 'ENOENT') throw error; }
  await mkdir(path.dirname(to), { recursive: true });
  const database = new DatabaseSync(from, { readOnly: true });
  try { database.prepare('VACUUM INTO ?').run(to); }
  finally { database.close(); }
  const backup = new DatabaseSync(to, { readOnly: true });
  try {
    const result = backup.prepare('PRAGMA integrity_check').get();
    if (result.integrity_check !== 'ok') throw new Error('Backup integrity check failed.');
    return { path: to, integrity: 'ok', records: backup.prepare('SELECT COUNT(*) AS count FROM app_records').get().count };
  } finally { backup.close(); }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
  const source = process.env.SQLITE_PATH || path.join(root, 'data', 'commerce.sqlite');
  const destination = process.argv[2] || path.join(root, 'data', 'backups', `commerce-${new Date().toISOString().replaceAll(':', '-')}.sqlite`);
  const result = await backupSqlite(source, destination);
  console.log(JSON.stringify(result));
}
