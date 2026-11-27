import { before, after, test } from 'node:test';
import assert from 'node:assert/strict';
import { initializeApp, deleteApp } from 'firebase-admin/app';
import { getFirestore, Timestamp } from 'firebase-admin/firestore';
import { hashKey } from '../src/server/alerts.mjs';
import { handleHeartbeat, validateHeartbeat } from '../src/server/heartbeat.mjs';

let app, db, sequence = 0;
const key = 'H'.repeat(43);
const body = { firmware_version: 'ott-ids-1.1.0', uptime_ms: 123456, wifi_rssi_dbm: -60,
  free_heap_bytes: 190000, outbox_pending: 0, outbox_rejected: 0, outbox_capacity: 256, storage_ready: true };
before(() => {
  assert.equal(process.env.FIRESTORE_EMULATOR_HOST, '127.0.0.1:8085');
  app = initializeApp({ projectId: 'demo-lastdance' }, 'heartbeat-tests'); db = getFirestore(app);
});
after(async () => { await db?.terminate(); if (app) await deleteApp(app); });
async function fixture() {
  const deviceId = `HEARTBEAT-${++sequence}`, orgId = `hb-org-${sequence}`;
  const device = db.doc(`organizations/${orgId}/devices/${deviceId}`);
  const credential = db.doc(`deviceCredentials/${deviceId}`);
  await Promise.all([device.set({ name: 'Keep this name', location: 'Lab' }),
    db.doc(`organizations/${orgId}`).set({ name: orgId }),
    credential.set({ orgId, keyHash: hashKey(key), enabled: true })]);
  return { deviceId, orgId, device, credential };
}
function request(deviceId, payload = body, suppliedKey = key, headers = {}) {
  return new Request('http://local/api/device/heartbeat', { method: 'POST', headers: {
    'content-type': 'application/json', 'x-device-id': deviceId, 'x-device-key': suppliedKey, ...headers,
  }, body: JSON.stringify(payload) });
}
const send = req => handleHeartbeat(req, () => db);

test('idle device writes telemetry with a server timestamp, keeps metadata and creates no alert', async () => {
  const f = await fixture();
  const response = await send(request(f.deviceId));
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { accepted: true, updated: true, retry_after_ms: 60000 });
  assert.equal(response.headers.get('cache-control'), 'no-store');
  const stored = (await f.device.get()).data();
  assert.equal(stored.name, 'Keep this name'); assert.equal(stored.location, 'Lab');
  assert.deepEqual(stored.heartbeat, body); assert.ok(stored.last_heartbeat_at.toMillis() <= Date.now());
  assert.ok(Date.now() - stored.last_heartbeat_at.toMillis() < 10000);
  assert.equal((await f.device.collection('alerts').get()).size, 0);
});
test('frequent and concurrent heartbeats do not repeatedly write or replace telemetry', async () => {
  const f = await fixture();
  const results = await Promise.all([send(request(f.deviceId)), send(request(f.deviceId))]);
  const values = await Promise.all(results.map(result => result.json()));
  assert.equal(values.filter(value => value.updated).length, 1);
  const before = (await f.device.get()).data();
  const response = await send(request(f.deviceId, { ...body, outbox_pending: 9 }));
  assert.equal((await response.json()).updated, false);
  const after = (await f.device.get()).data();
  assert.equal(after.last_heartbeat_at.toMillis(), before.last_heartbeat_at.toMillis());
  assert.equal(after.heartbeat.outbox_pending, 0);
  await f.device.update({ last_heartbeat_at: Timestamp.fromMillis(Date.now() - 46000) });
  assert.equal((await (await send(request(f.deviceId, { ...body, outbox_pending: 9 }))).json()).updated, true);
});
test('wrong, unknown, disabled and rotated credentials cannot update heartbeat, including inside throttle window', async () => {
  const f = await fixture();
  assert.equal((await send(request('unknown-hb'))).status, 401);
  assert.equal((await send(request(f.deviceId, body, 'X'.repeat(43)))).status, 401);
  await send(request(f.deviceId));
  const timestamp = (await f.device.get()).data().last_heartbeat_at.toMillis();
  await f.credential.update({ enabled: false });
  assert.equal((await send(request(f.deviceId))).status, 403);
  await f.credential.update({ enabled: true, keyHash: hashKey('R'.repeat(43)) });
  assert.equal((await send(request(f.deviceId))).status, 401);
  assert.equal((await f.device.get()).data().last_heartbeat_at.toMillis(), timestamp);
});
test('registry ownership decides tenant and missing organization/device is rejected', async () => {
  const f = await fixture();
  assert.equal((await send(request(f.deviceId, { ...body, orgId: 'other' }))).status, 422);
  await f.device.delete(); assert.equal((await send(request(f.deviceId))).status, 403);
  await f.device.set({ name: 'Device' });
  await db.doc(`organizations/${f.orgId}`).delete();
  assert.equal((await send(request(f.deviceId))).status, 403);
});
test('schema rejects spoofed time, unknown fields and malformed telemetry, but accepts blocked storage', () => {
  for (const delta of [{ last_heartbeat_at: 123 }, { uptime_ms: -1 }, { uptime_ms: Number.MAX_SAFE_INTEGER + 1 },
    { firmware_version: 'bad/version' }, { firmware_version: '' }, { wifi_rssi_dbm: -128 }, { wifi_rssi_dbm: 1 },
    { free_heap_bytes: 1.5 }, { outbox_pending: -1 }, { outbox_rejected: 1000001 }, { outbox_capacity: 0 },
    { storage_ready: 'true' }, { device_id: 'other' }]) {
    assert.throws(() => validateHeartbeat({ ...body, ...delta }), error => error.status === 422);
  }
  assert.equal(validateHeartbeat({ ...body, storage_ready: false }).storage_ready, false);
});
test('HTTP boundary rejects invalid headers, JSON and oversized bodies before database access', async () => {
  const noDB = () => { throw new Error('Database must not be accessed'); };
  assert.equal((await handleHeartbeat(request('bad/path'), noDB)).status, 401);
  assert.equal((await handleHeartbeat(request('good', body, key, { 'content-type': 'text/plain' }), noDB)).status, 415);
  const headers = { 'content-type': 'application/json', 'x-device-id': 'good', 'x-device-key': key };
  assert.equal((await handleHeartbeat(new Request('http://local', { method: 'POST', headers, body: '{' }), noDB)).status, 400);
  assert.equal((await handleHeartbeat(new Request('http://local', { method: 'POST', headers, body: ' '.repeat(17000) }), noDB)).status, 413);
});
test('database failure is retryable and does not acknowledge heartbeat', async () => {
  const response = await handleHeartbeat(request('good'), () => { throw { code: 'unavailable' }; });
  assert.equal(response.status, 503); assert.equal((await response.json()).accepted, false);
});
