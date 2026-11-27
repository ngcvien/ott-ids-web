import { before, after, test } from 'node:test';
import assert from 'node:assert/strict';
import { initializeApp, deleteApp } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { clearAlerts, handleClear, validateClearRequest } from '../src/server/clear-alerts.mjs';
import { hashKey, saveAlert, validateAlert } from '../src/server/alerts.mjs';

let app, db, sequence = 0;
const key = 'C'.repeat(43);
const payload = { boot_id: 'clear-test-boot', event_id: '1', timestamp_ms: 0, model_version: 0,
  class_id: 1, ingress_port: 0, src_ip: '192.0.2.1', dst_ip: '192.0.2.2', src_port: 1,
  dst_port: 2, protocol: 17, action: 'monitor', tree_error: 0, tree_steps: 0, latency_cycles: 0 };
before(() => {
  assert.equal(process.env.FIRESTORE_EMULATOR_HOST, '127.0.0.1:8085');
  app = initializeApp({ projectId: 'demo-lastdance' }, 'clear-alert-tests'); db = getFirestore(app);
});
after(async () => { await db?.terminate(); if (app) await deleteApp(app); });
async function fixture() {
  const deviceId = `CLEAR-${++sequence}`, orgId = `clear-org-${sequence}`;
  const device = db.doc(`organizations/${orgId}/devices/${deviceId}`);
  await Promise.all([
    device.set({ name: deviceId }), db.doc(`organizations/${orgId}`).set({ name: orgId }),
    db.doc(`deviceCredentials/${deviceId}`).set({ orgId, keyHash: hashKey(key), enabled: true }),
    db.doc(`organizations/${orgId}/members/clear-owner`).set({ role: 'owner' }),
    db.doc(`organizations/${orgId}/members/clear-viewer`).set({ role: 'viewer' }),
  ]);
  const alert = validateAlert(payload, deviceId);
  const stored = await saveAlert(db, deviceId, key, alert);
  return { device, deviceId, orgId, alert, input: { orgId, deviceId, ids: [stored.id] }, id: stored.id };
}
test('owner clears only requested records, retains dedup hash and late ESP retries do not recreate history', async () => {
  const f = await fixture();
  const second = await saveAlert(db, f.deviceId, key, validateAlert({ ...payload, event_id: '2' }, f.deviceId));
  assert.deepEqual(await clearAlerts(db, 'clear-owner', f.input), { cleared: 1 });
  assert.equal((await f.device.collection('alerts').doc(f.id).get()).exists, false);
  const receipt = (await f.device.collection('alertReceipts').doc(f.id).get()).data();
  assert.deepEqual(Object.keys(receipt).sort(), ['cleared_at', 'payload_hash']);
  assert.equal((await f.device.collection('alerts').doc(second.id).get()).exists, true);
  assert.equal((await saveAlert(db, f.deviceId, key, f.alert)).duplicate, true);
  assert.equal((await f.device.collection('alerts').doc(f.id).get()).exists, false);
  await assert.rejects(saveAlert(db, f.deviceId, key, { ...f.alert, class_id: 2 }), error => error.status === 409);
  assert.deepEqual(await clearAlerts(db, 'clear-owner', f.input), { cleared: 0 });
});
test('viewer, nonmember and owner of another tenant cannot clear data', async () => {
  const f = await fixture();
  for (const uid of ['clear-viewer', 'outsider']) {
    await assert.rejects(clearAlerts(db, uid, f.input), error => error.status === 403);
  }
  await db.doc(`organizations/other-clear-org/members/outsider`).set({ role: 'owner' });
  await assert.rejects(clearAlerts(db, 'outsider', f.input), error => error.status === 403);
  assert.equal((await f.device.collection('alerts').doc(f.id).get()).exists, true);
});
test('concurrent device retry and deletion preserve deduplication', async () => {
  const f = await fixture();
  await Promise.all([clearAlerts(db, 'clear-owner', f.input), saveAlert(db, f.deviceId, key, f.alert)]);
  assert.equal((await f.device.collection('alerts').doc(f.id).get()).exists, false);
  assert.equal((await saveAlert(db, f.deviceId, key, f.alert)).duplicate, true);
});
test('invalid input cannot escape the tenant path or exceed 100 requested records', () => {
  const base = { orgId: 'org', deviceId: 'device', ids: ['id'] };
  for (const change of [{ orgId: '../escape' }, { ids: [] }, { ids: ['id', 'id'] },
    { ids: ['../../escape'] }, { ids: Array.from({ length: 101 }, (_, i) => `id-${i}`) }, { extra: true }]) {
    assert.throws(() => validateClearRequest({ ...base, ...change }), error => error.status === 422);
  }
});
test('HTTP requires a user token and handles expired sessions without touching the DB', async () => {
  const unavailableDB = () => { throw new Error('Must not access DB'); };
  let response = await handleClear(new Request('http://local/api/alerts', { method: 'DELETE' }), unavailableDB, () => { throw new Error('Must not verify'); });
  assert.equal(response.status, 401);
  response = await handleClear(new Request('http://local/api/alerts', { method: 'DELETE', headers: { Authorization: 'Bearer expired' } }), unavailableDB,
    async () => { throw Object.assign(new Error('expired'), { code: 'auth/id-token-expired' }); });
  assert.equal(response.status, 401);
});
test('authenticated HTTP deletion succeeds with owner membership', async () => {
  const f = await fixture();
  const response = await handleClear(new Request('http://local/api/alerts', { method: 'DELETE', headers: {
    Authorization: 'Bearer test-fixture-token', 'Content-Type': 'application/json',
  }, body: JSON.stringify(f.input) }), () => db, async () => ({ uid: 'clear-owner' }));
  assert.equal(response.status, 200); assert.equal((await response.json()).cleared, 1);
});
