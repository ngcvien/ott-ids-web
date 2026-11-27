import { FieldValue } from 'firebase-admin/firestore';
import { ApiError, authenticated, readBody, validId } from './alerts.mjs';
import { heartbeatModelCommand } from './models.mjs';

export const HEARTBEAT_MIN_INTERVAL_MS = 45000;
export function validateHeartbeat(body) {
  const fail = field => { throw new ApiError(422, 'invalid_heartbeat', `Invalid heartbeat field: ${field}`); };
  if (!body || typeof body !== 'object' || Array.isArray(body)) fail('body');
  const fields = ['firmware_version', 'uptime_ms', 'wifi_rssi_dbm', 'free_heap_bytes', 'outbox_pending', 'outbox_rejected', 'outbox_capacity', 'storage_ready', 'fpga'];
  if (Object.keys(body).some(field => !fields.includes(field))) fail('unknown');
  if (typeof body.firmware_version !== 'string' || !/^[A-Za-z0-9._-]{1,64}$/.test(body.firmware_version)) fail('firmware_version');
  const result = { firmware_version: body.firmware_version };
  for (const [field, min, max] of [
    ['uptime_ms', 0, Number.MAX_SAFE_INTEGER], ['wifi_rssi_dbm', -127, 0],
    ['free_heap_bytes', 0, 0xffffffff], ['outbox_pending', 0, 1000000],
    ['outbox_rejected', 0, 1000000], ['outbox_capacity', 1, 1000000],
  ]) {
    if (!Number.isSafeInteger(body[field]) || body[field] < min || body[field] > max) fail(field);
    result[field] = body[field];
  }
  if (typeof body.storage_ready !== 'boolean') fail('storage_ready');
  result.storage_ready = body.storage_ready;
  if (body.fpga !== undefined) {
    const fpga = body.fpga;
    if (!fpga || typeof fpga !== 'object' || Array.isArray(fpga) || Object.keys(fpga).some(key => !['spi_ready', 'model_valid', 'active_version', 'protocol_error', 'load_error', 'run_enabled'].includes(key))) fail('fpga');
    for (const field of ['spi_ready', 'model_valid', 'run_enabled']) if (typeof fpga[field] !== 'boolean') fail(`fpga.${field}`);
    for (const [field, max] of [['active_version', 0xffffffff], ['protocol_error', 15], ['load_error', 15]]) if (!Number.isSafeInteger(fpga[field]) || fpga[field] < 0 || fpga[field] > max) fail(`fpga.${field}`);
    result.fpga = { spi_ready: fpga.spi_ready, model_valid: fpga.model_valid, active_version: fpga.active_version,
      protocol_error: fpga.protocol_error, load_error: fpga.load_error, run_enabled: fpga.run_enabled };
  }
  return result;
}

export async function saveHeartbeat(db, deviceId, key, heartbeat) {
  return db.runTransaction(async transaction => {
    const credential = (await transaction.get(db.doc(`deviceCredentials/${deviceId}`))).data();
    if (!authenticated(credential, key)) throw new ApiError(401, 'invalid_device', 'Invalid device credential');
    if (credential.enabled !== true) throw new ApiError(403, 'device_disabled', 'Device is disabled');
    if (!validId(credential.orgId)) throw new ApiError(503, 'device_unavailable', 'Device configuration unavailable');
    const device = db.doc(`organizations/${credential.orgId}/devices/${deviceId}`);
    const [deviceSnapshot, organization] = await transaction.getAll(device, db.doc(`organizations/${credential.orgId}`));
    if (!deviceSnapshot.exists || !organization.exists) throw new ApiError(403, 'device_unregistered', 'Device is not registered');
    const modelCommand = heartbeatModelCommand(deviceSnapshot.data());
    const previous = deviceSnapshot.data().last_heartbeat_at?.toMillis?.();
    // Authenticate before throttling, including disabled/rotated keys. The transaction
    // serializes concurrent requests so they cannot all write one telemetry update.
    if (Number.isFinite(previous) && Date.now() - previous < HEARTBEAT_MIN_INTERVAL_MS) {
      return { accepted: true, updated: false, retry_after_ms: 60000, ...modelCommand };
    }
    transaction.update(device, { heartbeat, last_heartbeat_at: FieldValue.serverTimestamp() });
    return { accepted: true, updated: true, retry_after_ms: 60000, ...modelCommand };
  });
}

export async function handleHeartbeat(request, getDatabase) {
  const headers = { 'Cache-Control': 'no-store' };
  try {
    const deviceId = request.headers.get('x-device-id'), key = request.headers.get('x-device-key');
    if (!validId(deviceId) || typeof key !== 'string' || !/^[A-Za-z0-9_-]{43}$/.test(key)) {
      throw new ApiError(401, 'invalid_device', 'Invalid device credential');
    }
    if (request.headers.get('content-type')?.split(';')[0].trim().toLowerCase() !== 'application/json') {
      throw new ApiError(415, 'unsupported_media_type', 'Content-Type must be application/json');
    }
    const heartbeat = validateHeartbeat(await readBody(request));
    return Response.json(await saveHeartbeat(getDatabase(), deviceId, key, heartbeat), { headers });
  } catch (error) {
    if (error instanceof ApiError) return Response.json({ accepted: false, code: error.code, detail: error.message }, { status: error.status, headers });
    console.error('device_heartbeat_failed', { code: String(error?.code || 'unknown') });
    return Response.json({ accepted: false, code: 'temporarily_unavailable' }, { status: 503, headers });
  }
}
