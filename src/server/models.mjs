import { FieldValue } from 'firebase-admin/firestore';
import { ApiError, authenticated, readBody, validId } from './alerts.mjs';
import { modelIdFor, validateModel } from './model-format.mjs';

const ACTIVE = ['queued', 'downloading', 'loading'];
const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;
const HASH = /^[a-f0-9]{64}$/;
const ERRORS = ['invalid_model', 'storage_failed', 'fpga_not_ready', 'fpga_load_failed', 'commit_failed', 'interrupted'];
const requireInput = (value, keys) => {
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).some(key => !keys.includes(key))) {
    throw new ApiError(422, 'invalid_request', 'Invalid request fields');
  }
};
async function requireOwner(transaction, db, orgId, uid) {
  if (!validId(orgId) || !validId(uid)) throw new ApiError(422, 'invalid_request', 'Invalid organization or user');
  if ((await transaction.get(db.doc(`organizations/${orgId}/members/${uid}`))).data()?.role !== 'owner') {
    throw new ApiError(403, 'owner_required', 'Only an owner may manage models');
  }
}
export async function uploadModel(db, uid, input) {
  requireInput(input, ['orgId', 'name', 'model']);
  if (typeof input.name !== 'string' || !input.name.trim() || input.name.trim().length > 80) throw new ApiError(422, 'invalid_request', 'Model name required (1–80 characters)');
  const model = validateModel(input.model), id = modelIdFor(model);
  return db.runTransaction(async transaction => {
    await requireOwner(transaction, db, input.orgId, uid);
    const ref = db.doc(`organizations/${input.orgId}/models/${id}`);
    const version = db.doc(`organizations/${input.orgId}/modelVersions/${model.version}`);
    const [existing, reserved] = await transaction.getAll(ref, version);
    if (reserved.exists && reserved.data().model_id !== id) throw new ApiError(409, 'version_conflict', 'This version is already bound to different model content');
    if (!existing.exists) {
      transaction.create(ref, { name: input.name.trim(), model, created_by: uid, created_at: FieldValue.serverTimestamp() });
      transaction.set(version, { model_id: id });
    }
    return { model_id: id, duplicate: existing.exists };
  });
}
export async function manageModelCommand(db, uid, input) {
  requireInput(input, ['orgId', 'deviceId', 'modelId', 'commandId', 'action']);
  if (!validId(input.deviceId) || typeof input.commandId !== 'string' || !UUID.test(input.commandId) || !['deploy', 'cancel'].includes(input.action) ||
      (input.action === 'deploy' && !HASH.test(input.modelId || ''))) throw new ApiError(422, 'invalid_request', 'Invalid device/model/command/action');
  return db.runTransaction(async transaction => {
    await requireOwner(transaction, db, input.orgId, uid);
    const device = db.doc(`organizations/${input.orgId}/devices/${input.deviceId}`);
    const job = device.collection('modelCommands').doc(input.commandId);
    const [deviceSnapshot, existing] = await transaction.getAll(device, job);
    if (!deviceSnapshot.exists) throw new ApiError(404, 'device_not_found', 'Device not found');
    const current = deviceSnapshot.data().model_update;
    if (input.action === 'cancel') {
      if (!existing.exists || current?.command_id !== input.commandId) throw new ApiError(404, 'command_not_found', 'Command not found');
      if (existing.data().status === 'cancelled') return { command_id: input.commandId, status: 'cancelled' };
      if (!['queued', 'downloading'].includes(existing.data().status)) throw new ApiError(409, 'cannot_cancel', 'Loading or completed command cannot be cancelled');
      const next = { ...current, status: 'cancelled', updated_at: FieldValue.serverTimestamp() };
      transaction.update(job, { status: 'cancelled', updated_at: FieldValue.serverTimestamp() });
      transaction.update(device, { model_update: next });
      return { command_id: input.commandId, status: 'cancelled' };
    }
    if (existing.exists) {
      if (existing.data().model_id !== input.modelId) throw new ApiError(409, 'command_conflict', 'Command ID is bound to another model');
      return { command_id: input.commandId, status: existing.data().status, duplicate: true };
    }
    if (ACTIVE.includes(current?.status)) throw new ApiError(409, 'device_busy', 'A model command is already pending for this device');
    const modelSnapshot = await transaction.get(db.doc(`organizations/${input.orgId}/models/${input.modelId}`));
    if (!modelSnapshot.exists) throw new ApiError(404, 'model_not_found', 'Model not found');
    const model = validateModel(modelSnapshot.data().model);
    if (modelIdFor(model) !== input.modelId) throw new ApiError(409, 'invalid_model', 'Stored model identity mismatch');
    const summary = { command_id: input.commandId, model_id: input.modelId, name: modelSnapshot.data().name,
      version: model.version, sha256: model.sha256, node_count: model.node_count, abi: model.abi,
      status: 'queued', requested_by: uid, requested_at: FieldValue.serverTimestamp(), updated_at: FieldValue.serverTimestamp() };
    transaction.create(job, summary);
    transaction.update(device, { model_update: summary });
    return { command_id: input.commandId, status: 'queued', duplicate: false };
  });
}
export function heartbeatModelCommand(deviceData) {
  const job = deviceData?.model_update;
  return job && ACTIVE.includes(job.status) ? { model_command: { command_id: job.command_id, model_id: job.model_id } } : {};
}
async function deviceContext(transaction, db, deviceId, key, commandId) {
  if (typeof commandId !== 'string' || !UUID.test(commandId)) throw new ApiError(422, 'invalid_request', 'Invalid command ID');
  const credential = (await transaction.get(db.doc(`deviceCredentials/${deviceId}`))).data();
  if (!authenticated(credential, key)) throw new ApiError(401, 'invalid_device', 'Invalid device credential');
  if (credential.enabled !== true) throw new ApiError(403, 'device_disabled', 'Device is disabled');
  if (!validId(credential.orgId)) throw new ApiError(503, 'device_unavailable', 'Invalid registry');
  const device = db.doc(`organizations/${credential.orgId}/devices/${deviceId}`), job = device.collection('modelCommands').doc(commandId);
  const [deviceSnapshot, jobSnapshot, org] = await transaction.getAll(device, job, db.doc(`organizations/${credential.orgId}`));
  if (!deviceSnapshot.exists || !org.exists) throw new ApiError(403, 'device_unregistered', 'Device not registered');
  if (!jobSnapshot.exists || deviceSnapshot.data().model_update?.command_id !== commandId) throw new ApiError(409, 'stale_command', 'Command is no longer current');
  return { device, job, data: jobSnapshot.data(), orgId: credential.orgId };
}
export async function downloadDeviceModel(db, deviceId, key, input) {
  requireInput(input, ['command_id']);
  return db.runTransaction(async transaction => {
    const context = await deviceContext(transaction, db, deviceId, key, input.command_id);
    if (!ACTIVE.includes(context.data.status)) throw new ApiError(409, 'command_finished', 'Command is no longer active');
    const stored = await transaction.get(db.doc(`organizations/${context.orgId}/models/${context.data.model_id}`));
    if (!stored.exists) throw new ApiError(404, 'model_not_found', 'Model not found');
    const model = validateModel(stored.data().model);
    if (modelIdFor(model) !== context.data.model_id) throw new ApiError(409, 'invalid_model', 'Stored model identity mismatch');
    return { command_id: input.command_id, model_id: context.data.model_id, model };
  });
}
export function validateModelResult(input) {
  requireInput(input, ['command_id', 'status', 'error', 'active_version', 'model_valid', 'protocol_error', 'load_error', 'run_enabled', 'sha256']);
  if (typeof input.command_id !== 'string' || !UUID.test(input.command_id) || !['downloading', 'loading', 'succeeded', 'failed'].includes(input.status)) throw new ApiError(422, 'invalid_result', 'Invalid command or status');
  if (input.status === 'failed' && !ERRORS.includes(input.error)) throw new ApiError(422, 'invalid_result', 'Expected known failure reason');
  const allowed = input.status === 'succeeded' ? ['command_id', 'status', 'active_version', 'model_valid', 'protocol_error', 'load_error', 'run_enabled', 'sha256'] :
    input.status === 'failed' ? ['command_id', 'status', 'error'] : ['command_id', 'status'];
  if (Object.keys(input).some(key => !allowed.includes(key))) throw new ApiError(422, 'invalid_result', 'Unexpected result fields');
  for (const [field, max] of [['active_version', 0xffffffff], ['protocol_error', 15], ['load_error', 15]]) {
    if (input[field] !== undefined && (!Number.isSafeInteger(input[field]) || input[field] < 0 || input[field] > max)) throw new ApiError(422, 'invalid_result', `Invalid ${field}`);
  }
  for (const field of ['model_valid', 'run_enabled']) if (input[field] !== undefined && typeof input[field] !== 'boolean') throw new ApiError(422, 'invalid_result', `Invalid ${field}`);
  if (input.sha256 !== undefined && !HASH.test(input.sha256)) throw new ApiError(422, 'invalid_result', 'Invalid hash');
  return input;
}
export async function reportModelResult(db, deviceId, key, body) {
  const input = validateModelResult(body);
  return db.runTransaction(async transaction => {
    const context = await deviceContext(transaction, db, deviceId, key, input.command_id);
    const { data, device, job } = context;
    if (!ACTIVE.includes(data.status)) {
      if (data.status === input.status) return { accepted: true, duplicate: true };
      throw new ApiError(409, 'command_finished', 'Cannot change a terminal command');
    }
    if (input.status === 'succeeded' && (data.status !== 'loading' || input.active_version !== data.version ||
        input.sha256 !== data.sha256 || input.model_valid !== true || input.protocol_error !== 0 || input.load_error !== 0 || input.run_enabled !== false)) {
      throw new ApiError(409, 'verification_failed', 'FPGA must report the expected valid model, zero errors and enforcement off');
    }
    if (data.status === 'loading' && input.status === 'downloading') throw new ApiError(409, 'invalid_transition', 'Cannot move loading back to downloading');
    if (data.status === input.status) return { accepted: true, duplicate: true };
    const { command_id, ...result } = input;
    const summary = { ...data, ...result, updated_at: FieldValue.serverTimestamp() };
    const updates = { model_update: summary };
    if (input.status === 'succeeded') updates.active_model = { model_id: data.model_id, version: data.version, sha256: data.sha256,
      command_id, verified_at: FieldValue.serverTimestamp(), run_enabled: false };
    transaction.update(job, { ...result, updated_at: FieldValue.serverTimestamp() });
    transaction.update(device, updates);
    return { accepted: true, duplicate: false };
  });
}
// Token verification is injected so emulator tests never require production Auth.
export async function modelAdminHttp(request, getDatabase, verifyToken, operation) {
  try {
    const auth = request.headers.get('authorization') || '';
    if (!auth.startsWith('Bearer ') || auth.length <= 7 || auth.length > 8192) throw new ApiError(401, 'unauthorized', 'Sign in required');
    let user;
    try { user = await verifyToken(auth.slice(7)); }
    catch (error) { if (String(error?.code).startsWith('auth/') && !['auth/internal-error', 'auth/insufficient-permission'].includes(error.code)) throw new ApiError(401, 'unauthorized', 'Invalid session'); throw error; }
    if (request.headers.get('content-type')?.split(';')[0].trim() !== 'application/json') throw new ApiError(415, 'unsupported_media_type', 'JSON required');
    const body = await readBody(request);
    return Response.json(await operation(getDatabase(), user.uid, body), { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) { return modelHttpError(error); }
}
export async function modelDeviceHttp(request, getDatabase, operation) {
  try {
    const deviceId = request.headers.get('x-device-id'), key = request.headers.get('x-device-key');
    if (!validId(deviceId) || typeof key !== 'string' || !/^[A-Za-z0-9_-]{43}$/.test(key)) throw new ApiError(401, 'invalid_device', 'Invalid credential');
    if (request.headers.get('content-type')?.split(';')[0].trim() !== 'application/json') throw new ApiError(415, 'unsupported_media_type', 'JSON required');
    const body = await readBody(request);
    return Response.json(await operation(getDatabase(), deviceId, key, body), { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) { return modelHttpError(error); }
}
function modelHttpError(error) {
  if (error instanceof ApiError) return Response.json({ accepted: false, code: error.code, detail: error.message }, { status: error.status, headers: { 'Cache-Control': 'no-store' } });
  console.error('model_operation_failed', { code: String(error?.code || 'unknown') });
  return Response.json({ accepted: false, code: 'temporarily_unavailable' }, { status: 503, headers: { 'Cache-Control': 'no-store' } });
}
