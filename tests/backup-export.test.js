import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createStore } from '../src/db.js';
import { backupSqlite } from '../scripts/backup.mjs';
import { ordersCsv } from '../src/export.js';

test('online SQLite backup is consistent, readable, and refuses overwrite', async t => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'commerce-backup-test-'));
  t.after(() => {
    const resolved = path.resolve(dir), parent = path.resolve(os.tmpdir());
    assert.equal(path.dirname(resolved), parent);
    assert.ok(path.basename(resolved).startsWith('commerce-backup-test-'));
    return rm(resolved, { recursive: true, force: true });
  });
  const store = await createStore({ filename: path.join(dir, 'source.sqlite') });
  await store.put('settings', { id: 'restore-proof', value: 'بيانات عربية' });
  const destination = path.join(dir, 'backup.sqlite');
  const result = await backupSqlite(path.join(dir, 'source.sqlite'), destination);
  assert.equal(result.integrity, 'ok'); assert.equal(result.records, 1);
  await assert.rejects(backupSqlite(path.join(dir, 'source.sqlite'), destination), /already exists/);
  await store.put('settings', { id: 'after-backup', value: 'new' });
  const restored = await createStore({ filename: destination });
  assert.equal((await restored.get('settings', 'restore-proof')).value, 'بيانات عربية');
  assert.equal(await restored.get('settings', 'after-backup'), null);
  await restored.close(); await store.close();
});

test('CSV preserves Arabic/commas/quotes and neutralizes spreadsheet formulas', () => {
  const csv = ordersCsv([{ id: 'order-1', createdAt: '2026-11-01', status: 'confirmed', productName: 'منتج "أ"', quantity: 1, unitPricePiasters: 35000, shippingPiasters: 6000, totalPiasters: 41000, customer: { name: '=1+2', phone: '+201012345678', address: 'شارع, القاهرة' } }]);
  assert.ok(csv.startsWith('\uFEFF'));
  assert.ok(csv.includes('"\'=1+2"'));
  assert.ok(csv.includes('"\'+201012345678"'));
  assert.ok(csv.includes('"منتج ""أ"""'));
  assert.ok(csv.includes('"410.00"'));
  assert.ok(csv.includes('"شارع, القاهرة"'));
});
