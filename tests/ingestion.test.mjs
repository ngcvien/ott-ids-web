import { after, before, test } from 'node:test';
import { execFile } from 'node:child_process';
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import assert from 'node:assert/strict';
import { initializeApp, deleteApp } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { handleAlert, hashKey, MAX_BODY_BYTES } from '../src/server/alerts.mjs';

let app, db, sequence = 0;
const key = 'K'.repeat(43); // Emulator-only fixture, never used on a real device.
const body = {
  boot_id: 'boot-001', event_id: '18446744073709551615', timestamp_ms: 123456,
  model_version: 16777217, class_id: 1, ingress_port: 2, src_ip: '192.168.50.11',
  dst_ip: '192.168.50.12', src_port: 41000, dst_port: 40000, protocol: 17,
  action: 'monitor', tree_error: 0, tree_steps: 9, latency_cycles: 9,
};
before(() => {
  assert.equal(process.env.FIRESTORE_EMULATOR_HOST, '127.0.0.1:8085', 'Tests require the local emulator');
  app = initializeApp({ projectId: 'demo-lastdance' }, 'ingestion-tests');
  db = getFirestore(app);
});
after(async () => { await db?.terminate(); if (app) await deleteApp(app); });

async function fixture() {
  const deviceId = `TEST-${++sequence}`;
  const orgId = `tenant-${deviceId}`;
  const device = db.doc(`organizations/${orgId}/devices/${deviceId}`);
  const credential = db.doc(`deviceCredentials/${deviceId}`);
  await Promise.all([
    db.doc(`organizations/${orgId}`).set({ name: orgId }),
    device.set({ name: deviceId }), credential.set({ orgId, keyHash: hashKey(key), enabled: true }),
  ]);
  return { deviceId, orgId, device, credential };
}
function request(deviceId, payload = body, suppliedKey = key, extraHeaders = {}) {
  return new Request('http://localhost/api/device/alerts', { method: 'POST',
    headers: { 'content-type': 'application/json', 'x-device-id': deviceId, 'x-device-key': suppliedKey, ...extraHeaders },
    body: JSON.stringify(payload),
  });
}
const send = req => handleAlert(req, () => db);

test('saves an alert to its server-selected tenant with a server timestamp', async () => {
  const fixtureData = await fixture();
  const response = await send(request(fixtureData.deviceId));
  assert.equal(response.status, 200);
  const result = await response.json();
  assert.equal(result.accepted, true); assert.equal(result.duplicate, false);
  assert.equal(response.headers.get('cache-control'), 'no-store');
  const stored = (await fixtureData.device.collection('alerts').doc(result.id).get()).data();
  assert.equal(stored.event_id, body.event_id);
  assert.equal(stored.device_id, fixtureData.deviceId);
  assert.equal(typeof stored.received_at.toMillis(), 'number');
  assert.equal(stored.keyHash, undefined); assert.equal(stored.deviceKey, undefined);
});
test('concurrent retries create exactly one document and preserve the first timestamp', async () => {
  const { deviceId, device } = await fixture();
  const results = await Promise.all(Array.from({ length: 6 }, async () => {
    const response = await send(request(deviceId));
    assert.equal(response.status, 200); return response.json();
  }));
  assert.equal(results.filter(result => !result.duplicate).length, 1);
  assert.equal(new Set(results.map(result => result.id)).size, 1);
  assert.equal((await device.collection('alerts').get()).size, 1);
  const event = device.collection('alerts').doc(results[0].id);
  const timestamp = (await event.get()).data().received_at.toMillis();
  assert.equal((await (await send(request(deviceId))).json()).duplicate, true);
  assert.equal((await event.get()).data().received_at.toMillis(), timestamp);
});
test('a reboot gets a new event; same identity with different content returns 409', async () => {
  const { deviceId, device } = await fixture();
  assert.equal((await send(request(deviceId))).status, 200);
  assert.equal((await send(request(deviceId, { ...body, boot_id: 'boot-002' }))).status, 200);
  assert.equal((await send(request(deviceId, { ...body, class_id: 2 }))).status, 409);
  assert.equal((await device.collection('alerts').get()).size, 2);
});
test('unknown device and wrong keys are rejected without writing', async () => {
  const { deviceId, device } = await fixture();
  assert.equal((await send(request('unknown-device'))).status, 401);
  assert.equal((await send(request(deviceId, body, 'B'.repeat(43)))).status, 401);
  assert.equal((await device.collection('alerts').get()).size, 0);
});
test('disable and rotation take effect immediately, including duplicate retries', async () => {
  const { deviceId, credential } = await fixture();
  assert.equal((await send(request(deviceId))).status, 200);
  await credential.update({ enabled: false });
  assert.equal((await send(request(deviceId))).status, 403);
  const newKey = 'N'.repeat(43);
  await credential.update({ enabled: true, keyHash: hashKey(newKey) });
  assert.equal((await send(request(deviceId))).status, 401);
  const response = await send(request(deviceId, body, newKey));
  assert.equal(response.status, 200); assert.equal((await response.json()).duplicate, true);
});
test('missing registry device cannot send and a payload cannot choose its tenant', async () => {
  const { deviceId, device } = await fixture();
  assert.equal((await send(request(deviceId, { ...body, orgId: 'another-tenant' }))).status, 422);
  assert.equal((await send(request(deviceId, { ...body, device_id: 'another-device' }))).status, 422);
  assert.equal((await device.collection('alerts').get()).size, 0);
  await device.delete();
  assert.equal((await send(request(deviceId))).status, 403);
});
test('validation rejects unsafe event IDs, malformed IP, missing boot identity and out-of-range fields', async () => {
  const { deviceId, device } = await fixture();
  for (const update of [{ event_id: 9007199254740992 }, { event_id: '18446744073709551616' },
    { event_id: '-1' }, { boot_id: undefined }, { src_ip: '999.1.1.1' }, { dst_ip: '::1' },
    { class_id: 64 }, { src_port: -1 }, { action: 'allow' }, { timestamp_ms: 0.1 }, { received_at: 'forged' }]) {
    assert.equal((await send(request(deviceId, { ...body, ...update }))).status, 422, JSON.stringify(update));
  }
  assert.equal((await device.collection('alerts').get()).size, 0);
});
test('normalizes non-TCP/UDP ports and accepts safe numeric event IDs', async () => {
  const { deviceId, device } = await fixture();
  const response = await send(request(deviceId, { ...body, protocol: 1, event_id: 42 }));
  assert.equal(response.status, 200);
  const stored = (await device.collection('alerts').doc((await response.json()).id).get()).data();
  assert.equal(stored.src_port, 0); assert.equal(stored.dst_port, 0); assert.equal(stored.event_id, '42');
});
test('HTTP boundary handles invalid auth, media type, JSON and actual oversized streams before DB access', async () => {
  const noDatabase = () => { throw new Error('Database must not be accessed'); };
  assert.equal((await handleAlert(new Request('http://local', { method: 'POST' }), noDatabase)).status, 401);
  assert.equal((await handleAlert(request('IDS-0001', body, key, { 'content-type': 'text/plain' }), noDatabase)).status, 415);
  for (const [text, expected] of [['{bad', 400], ['a'.repeat(MAX_BODY_BYTES + 1), 413]]) {
    const req = new Request('http://local', { method: 'POST', headers: {
      'content-type': 'application/json', 'x-device-id': 'IDS-0001', 'x-device-key': key,
    }, body: text });
    assert.equal((await handleAlert(req, noDatabase)).status, expected);
  }
});
test('DB outage returns retryable 503 and never acknowledges delivery', async () => {
  const response = await handleAlert(request('IDS-0001'), () => { throw Object.assign(new Error('private server detail'), { code: 'unavailable' }); });
  assert.equal(response.status, 503);
  const result = await response.json();
  assert.equal(result.accepted, false); assert.equal(result.detail.includes('private'), false);
});

test('credential CLI issues, refuses implicit replacement, rotates and disables without logging secrets', async () => {
  const { deviceId, orgId, credential } = await fixture();
  await credential.delete();
  const directory = await mkdtemp(join(tmpdir(), 'lastdance-credential-test-'));
  const script = fileURLToPath(new URL('../scripts/device-key.mjs', import.meta.url));
  const invoke = (...args) => promisify(execFile)(process.execPath, [script, '--org', orgId, '--device', deviceId, ...args], {
    cwd: directory,
    env: { ...process.env, FIREBASE_PROJECT_ID: 'demo-lastdance', NEXT_PUBLIC_FIREBASE_PROJECT_ID: 'demo-lastdance',
      FIRESTORE_EMULATOR_HOST: '127.0.0.1:8085' },
  });
  try {
    const output = await invoke();
    const files = await readdir(join(directory, '.device-secrets'));
    assert.equal(files.length, 1);
    const first = JSON.parse(await readFile(join(directory, '.device-secrets', files[0]), 'utf8'));
    assert.equal(output.stdout.includes(first.deviceKey), false);
    assert.equal((await credential.get()).data().keyHash, hashKey(first.deviceKey));
    assert.equal((await send(request(deviceId, body, first.deviceKey))).status, 200);
    await assert.rejects(invoke(), /already exists/);
    assert.equal((await readdir(join(directory, '.device-secrets'))).length, 1);
    await invoke('--rotate');
    const rotatedFiles = await readdir(join(directory, '.device-secrets'));
    const second = JSON.parse(await readFile(join(directory, '.device-secrets', rotatedFiles.find(file => file !== files[0])), 'utf8'));
    assert.notEqual(second.deviceKey, first.deviceKey);
    assert.equal((await send(request(deviceId, body, first.deviceKey))).status, 401);
    assert.equal((await send(request(deviceId, body, second.deviceKey))).status, 200);
    await invoke('--disable');
    assert.equal((await send(request(deviceId, body, second.deviceKey))).status, 403);
  } finally {
    // This is the isolated directory created above, never a user-provided path.
    await rm(directory, { recursive: true, force: true });
  }
});

