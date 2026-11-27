import { before, after, test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { initializeApp, deleteApp } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { hashKey } from '../src/server/alerts.mjs';
import { packModel, validateModel, modelIdFor } from '../src/server/model-format.mjs';
import { uploadModel, manageModelCommand, downloadDeviceModel, reportModelResult, modelAdminHttp, modelDeviceHttp, validateModelResult } from '../src/server/models.mjs';
import { saveHeartbeat, validateHeartbeat } from '../src/server/heartbeat.mjs';

let app, db, sequence = 0;
const key = 'M'.repeat(43);
const telemetry = { firmware_version: 'ott-ids-1.2.0', uptime_ms: 1, wifi_rssi_dbm: -50, free_heap_bytes: 180000,
  outbox_pending: 0, outbox_rejected: 0, outbox_capacity: 256, storage_ready: true };
before(() => {
  assert.equal(process.env.FIRESTORE_EMULATOR_HOST, '127.0.0.1:8085');
  app = initializeApp({ projectId: 'demo-lastdance' }, 'model-tests'); db = getFirestore(app);
});
after(async () => { await db?.terminate(); if (app) await deleteApp(app); });
async function fixture() {
  const orgId = `model-org-${++sequence}`, deviceId = `MODEL-DEVICE-${sequence}`;
  const device = db.doc(`organizations/${orgId}/devices/${deviceId}`), credential = db.doc(`deviceCredentials/${deviceId}`);
  await Promise.all([db.doc(`organizations/${orgId}`).set({ name: orgId }), device.set({ name: deviceId }),
    credential.set({ orgId, keyHash: hashKey(key), enabled: true }),
    db.doc(`organizations/${orgId}/members/model-owner`).set({ role: 'owner' }),
    db.doc(`organizations/${orgId}/members/model-viewer`).set({ role: 'viewer' })]);
  const model = packModel(['00000003fffffc10'], 33554433);
  const uploaded = await uploadModel(db, 'model-owner', { orgId, name: 'Test model', model });
  const input = { orgId, deviceId, modelId: uploaded.model_id, commandId: randomUUID(), action: 'deploy' };
  return { orgId, deviceId, device, credential, model, input, modelId: uploaded.model_id };
}
const statusError = status => error => error.status === status;
const report = (f, status, extra = {}) => reportModelResult(db, f.deviceId, key, { command_id: f.input.commandId, status, ...extra });
const success = f => ({ active_version: f.model.version, sha256: f.model.sha256, model_valid: true, protocol_error: 0, load_error: 0, run_enabled: false });

test('release package matches existing 71-node FPGA CRC; canonical SHA is over little-endian binary words', async () => {
  const model = JSON.parse(await readFile(new URL('../public/models/gateway24-model2.json', import.meta.url), 'utf8'));
  assert.equal(model.node_count, 71); assert.equal(model.crc32, '44124ea7');
  assert.deepEqual(validateModel(model), model);
  assert.equal(modelIdFor(validateModel({ ...model, words: model.words.map(word => word.toUpperCase()), sha256: model.sha256.toUpperCase() })), modelIdFor(model));
});
test('schema rejects incompatible ABI, corrupt checksums, unsafe words, count and version', () => {
  const model = packModel(['00000003fffffc10'], 1);
  for (const change of [{ abi: 2 }, { node_count: 0 }, { node_count: 128 }, { version: -1 }, { version: 4294967296 },
    { words: [123] }, { words: ['0x00000003fffffc10'] }, { crc32: '00000000' }, { sha256: '0'.repeat(64) }, { unknown: true }]) {
    assert.throws(() => validateModel({ ...model, ...change }), statusError(422));
  }
  assert.equal(validateModel(packModel(Array(127).fill('00000003fffffc10'), 0xffffffff)).node_count, 127);
});
test('only the owner can upload; packages are immutable and one version cannot point at different words', async () => {
  const f = await fixture(), input = { orgId: f.orgId, name: 'Changed name', model: f.model };
  for (const uid of ['model-viewer', 'outsider']) await assert.rejects(uploadModel(db, uid, input), statusError(403));
  assert.equal((await uploadModel(db, 'model-owner', input)).duplicate, true);
  assert.equal((await db.doc(`organizations/${f.orgId}/models/${f.modelId}`).get()).data().name, 'Test model');
  await assert.rejects(uploadModel(db, 'model-owner', { ...input, model: packModel(['00000003fffffc11'], f.model.version) }), statusError(409));
});
test('owner command creation is idempotent, tenant scoped and allows only one pending command', async () => {
  const f = await fixture();
  for (const uid of ['model-viewer', 'outsider']) await assert.rejects(manageModelCommand(db, uid, f.input), statusError(403));
  const results = await Promise.all([manageModelCommand(db, 'model-owner', f.input), manageModelCommand(db, 'model-owner', f.input)]);
  assert.equal(results.filter(result => !result.duplicate).length, 1);
  assert.equal((await f.device.collection('modelCommands').get()).size, 1);
  await assert.rejects(manageModelCommand(db, 'model-owner', { ...f.input, commandId: randomUUID() }), statusError(409));
  await assert.rejects(manageModelCommand(db, 'model-owner', { ...f.input, orgId: '../escape' }), statusError(422));
});
test('concurrent different commands serialize to one winner', async () => {
  const f = await fixture();
  const results = await Promise.allSettled([manageModelCommand(db, 'model-owner', f.input), manageModelCommand(db, 'model-owner', { ...f.input, commandId: randomUUID() })]);
  assert.equal(results.filter(result => result.status === 'fulfilled').length, 1);
  assert.equal((await f.device.collection('modelCommands').get()).size, 1);
});
test('heartbeat delivers the pending command even inside telemetry throttling window, without creating an alert', async () => {
  const f = await fixture(); await saveHeartbeat(db, f.deviceId, key, telemetry);
  await manageModelCommand(db, 'model-owner', f.input);
  const heartbeat = await saveHeartbeat(db, f.deviceId, key, telemetry);
  assert.equal(heartbeat.updated, false);
  assert.deepEqual(heartbeat.model_command, { command_id: f.input.commandId, model_id: f.modelId });
  assert.equal((await f.device.collection('alerts').get()).size, 0);
});
test('device downloads only its assigned immutable model; wrong/disabled/other device keys cannot fetch it', async () => {
  const f = await fixture(), other = await fixture(); await manageModelCommand(db, 'model-owner', f.input);
  const body = { command_id: f.input.commandId };
  assert.deepEqual((await downloadDeviceModel(db, f.deviceId, key, body)).model, f.model);
  await assert.rejects(downloadDeviceModel(db, other.deviceId, key, body), statusError(409));
  await assert.rejects(downloadDeviceModel(db, f.deviceId, 'W'.repeat(43), body), statusError(401));
  await f.credential.update({ enabled: false });
  await assert.rejects(downloadDeviceModel(db, f.deviceId, key, body), statusError(403));
});
test('FPGA success requires loading authorization, matching version/hash, zero errors and RUN disabled', async () => {
  const f = await fixture(); await manageModelCommand(db, 'model-owner', f.input);
  await assert.rejects(report(f, 'succeeded', success(f)), statusError(409));
  await report(f, 'downloading'); await report(f, 'loading');
  for (const delta of [{ active_version: 7 }, { sha256: '0'.repeat(64) }, { model_valid: false }, { protocol_error: 1 }, { load_error: 1 }, { run_enabled: true }]) {
    await assert.rejects(report(f, 'succeeded', { ...success(f), ...delta }), statusError(409));
  }
  assert.equal((await report(f, 'succeeded', success(f))).accepted, true);
  const saved = (await f.device.get()).data();
  assert.equal(saved.model_update.status, 'succeeded'); assert.equal(saved.active_model.sha256, f.model.sha256);
  assert.equal((await report(f, 'succeeded', success(f))).duplicate, true);
  await assert.rejects(report(f, 'failed', { error: 'interrupted' }), statusError(409));
  assert.equal((await saveHeartbeat(db, f.deviceId, key, telemetry)).model_command, undefined);
});
test('failed/interrupted commands retain the previously verified active model and cannot be silently reapplied', async () => {
  const f = await fixture(); await f.device.update({ active_model: { version: 99 } });
  await manageModelCommand(db, 'model-owner', f.input); await report(f, 'loading');
  await report(f, 'failed', { error: 'interrupted' });
  assert.equal((await f.device.get()).data().active_model.version, 99);
  assert.equal((await report(f, 'failed', { error: 'interrupted' })).duplicate, true);
  await assert.rejects(report(f, 'loading'), statusError(409));
  await assert.rejects(downloadDeviceModel(db, f.deviceId, key, { command_id: f.input.commandId }), statusError(409));
  assert.equal((await manageModelCommand(db, 'model-owner', f.input)).status, 'failed');
});
test('cancellation before loading prevents download/authorization; loading cannot be cancelled', async () => {
  const f = await fixture(); await manageModelCommand(db, 'model-owner', f.input); await report(f, 'downloading');
  await manageModelCommand(db, 'model-owner', { ...f.input, action: 'cancel' });
  await assert.rejects(report(f, 'loading'), statusError(409));
  await assert.rejects(downloadDeviceModel(db, f.deviceId, key, { command_id: f.input.commandId }), statusError(409));
  const next = { ...f.input, commandId: randomUUID() };
  await manageModelCommand(db, 'model-owner', next);
  await reportModelResult(db, f.deviceId, key, { command_id: next.commandId, status: 'loading' });
  await assert.rejects(manageModelCommand(db, 'model-owner', { ...next, action: 'cancel' }), statusError(409));
  await assert.rejects(report(f, 'failed', { error: 'interrupted' }), statusError(409));
});
test('cancellation racing loading has one winner, preventing a cancelled command reaching loading', async () => {
  const f = await fixture(); await manageModelCommand(db, 'model-owner', f.input);
  const results = await Promise.allSettled([manageModelCommand(db, 'model-owner', { ...f.input, action: 'cancel' }), report(f, 'loading')]);
  assert.equal(results.filter(result => result.status === 'fulfilled').length, 1);
  assert.ok(['cancelled', 'loading'].includes((await f.device.get()).data().model_update.status));
});
test('result validation cannot overwrite command identity, models or terminal metadata', () => {
  const command_id = randomUUID();
  for (const input of [{ command_id: [command_id], status: 'loading' }, { command_id, status: 'done' }, { command_id, status: 'failed', error: 'anything' },
    { command_id, status: 'loading', version: 5 }, { command_id, status: 'loading', error: 'interrupted' },
    { command_id, status: 'failed', error: 'interrupted', sha256: '0'.repeat(64) }]) {
    assert.throws(() => validateModelResult(input), statusError(422));
  }
});
test('a corrupted stored package is rejected at download and cross-tenant device IDs cannot be targeted', async () => {
  const f = await fixture(), other = await fixture();
  await assert.rejects(manageModelCommand(db, 'model-owner', { ...f.input, deviceId: other.deviceId }), statusError(404));
  await manageModelCommand(db, 'model-owner', f.input);
  await db.doc(`organizations/${f.orgId}/models/${f.modelId}`).update({ 'model.crc32': '00000000' });
  await assert.rejects(downloadDeviceModel(db, f.deviceId, key, { command_id: f.input.commandId }), statusError(422));
});
test('concurrent uploads cannot bind the same version to two different models', async () => {
  const f = await fixture();
  const results = await Promise.allSettled(['00000003fffffc10', '00000003fffffc11'].map(word =>
    uploadModel(db, 'model-owner', { orgId: f.orgId, name: 'Version 2', model: packModel([word], 2) })));
  assert.equal(results.filter(result => result.status === 'fulfilled').length, 1);
});
test('heartbeat FPGA status is optional and validated separately from ESP presence', () => {
  assert.equal(validateHeartbeat(telemetry).fpga, undefined);
  const fpga = { spi_ready: true, model_valid: true, active_version: 1, protocol_error: 0, load_error: 0, run_enabled: false };
  assert.deepEqual(validateHeartbeat({ ...telemetry, fpga }).fpga, fpga);
  assert.throws(() => validateHeartbeat({ ...telemetry, fpga: { ...fpga, run_enabled: 1 } }), statusError(422));
});
test('HTTP endpoints reject missing authentication before touching database', async () => {
  const noDB = () => { throw new Error('Unexpected database access'); };
  const req = () => new Request('http://local', { method: 'POST', body: '{}' });
  assert.equal((await modelAdminHttp(req(), noDB, () => { throw new Error('Unexpected Auth'); }, uploadModel)).status, 401);
  assert.equal((await modelDeviceHttp(req(), noDB, downloadDeviceModel)).status, 401);
});
