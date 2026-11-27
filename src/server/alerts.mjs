import { createHash, timingSafeEqual } from 'node:crypto';
import { isIP } from 'node:net';
import { FieldValue } from 'firebase-admin/firestore';

export const MAX_BODY_BYTES = 16 * 1024;
export const validId = value => typeof value === 'string' && /^[A-Za-z0-9_-]{1,128}$/.test(value);
export const hashKey = key => createHash('sha256').update(key).digest('hex');
export class ApiError extends Error {
  constructor(status, code, message) { super(message); this.status = status; this.code = code; }
}
const invalid = field => { throw new ApiError(422, 'invalid_payload', `Invalid or missing field: ${field}`); };

export function validateAlert(body, deviceId) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) invalid('body');
  const fields = ['device_id', 'boot_id', 'event_id', 'timestamp_ms', 'model_version', 'class_id', 'ingress_port',
    'src_ip', 'dst_ip', 'src_port', 'dst_port', 'protocol', 'action', 'tree_error', 'tree_steps', 'latency_cycles'];
  if (Object.keys(body).some(field => !fields.includes(field))) invalid('unknown field');
  if (body.device_id !== undefined && body.device_id !== deviceId) invalid('device_id');
  if (typeof body.boot_id !== 'string' || !/^[A-Za-z0-9_-]{8,64}$/.test(body.boot_id)) invalid('boot_id');
  // A string preserves uint64 event IDs across JS / Firestore and retries.
  let eventId = body.event_id;
  if (typeof eventId === 'number' && Number.isSafeInteger(eventId) && eventId >= 0) eventId = String(eventId);
  if (typeof eventId !== 'string' || !/^(0|[1-9][0-9]{0,19})$/.test(eventId) || BigInt(eventId) > 18446744073709551615n) invalid('event_id');
  const alert = { boot_id: body.boot_id, event_id: eventId };
  for (const [field, max] of Object.entries({ timestamp_ms: Number.MAX_SAFE_INTEGER, model_version: 0xffffffff,
    class_id: 63, ingress_port: 3, src_port: 65535, dst_port: 65535, protocol: 255,
    tree_error: 7, tree_steps: 255, latency_cycles: 0xffffffff })) {
    const value = body[field];
    if (!Number.isSafeInteger(value) || value < 0 || value > max) invalid(field);
    alert[field] = value;
  }
  for (const field of ['src_ip', 'dst_ip']) {
    if (typeof body[field] !== 'string' || isIP(body[field]) !== 4) invalid(field);
    alert[field] = body[field];
  }
  if (!['monitor', 'drop'].includes(body.action)) invalid('action');
  alert.action = body.action;
  if (![6, 17].includes(alert.protocol)) { alert.src_port = 0; alert.dst_port = 0; }
  return alert;
}

function authenticated(record, key) {
  if (!record || typeof record.keyHash !== 'string' || !/^[a-f0-9]{64}$/.test(record.keyHash)) return false;
  return timingSafeEqual(Buffer.from(record.keyHash, 'hex'), Buffer.from(hashKey(key), 'hex'));
}

export async function saveAlert(db, deviceId, key, alert) {
  const alertId = hashKey(JSON.stringify([alert.boot_id, alert.event_id]));
  const payloadHash = hashKey(JSON.stringify(alert));
  return db.runTransaction(async transaction => {
    // Read credentials inside the transaction so revocation / rotation cannot race a write.
    const credential = (await transaction.get(db.doc(`deviceCredentials/${deviceId}`))).data();
    if (!authenticated(credential, key)) throw new ApiError(401, 'invalid_device', 'Invalid device credential');
    if (credential.enabled !== true) throw new ApiError(403, 'device_disabled', 'Device is disabled');
    if (!validId(credential.orgId)) throw new ApiError(503, 'device_unavailable', 'Device configuration unavailable');
    // Organization always comes from the trusted registry, never from the HTTP body.
    const device = db.doc(`organizations/${credential.orgId}/devices/${deviceId}`);
    const organization = db.doc(`organizations/${credential.orgId}`);
    const event = device.collection('alerts').doc(alertId);
    const receipt = device.collection('alertReceipts').doc(alertId);
    const [deviceSnapshot, orgSnapshot, eventSnapshot, receiptSnapshot] = await transaction.getAll(device, organization, event, receipt);
    if (!deviceSnapshot.exists || !orgSnapshot.exists) throw new ApiError(403, 'device_unregistered', 'Device is not registered');
    if (receiptSnapshot.exists) {
      if (receiptSnapshot.data().payload_hash !== payloadHash) throw new ApiError(409, 'event_conflict', 'Event ID already has different content');
      return { accepted: true, duplicate: true, id: alertId };
    }
    if (eventSnapshot.exists) {
      if (eventSnapshot.data().payload_hash !== payloadHash) throw new ApiError(409, 'event_conflict', 'Event ID already has different content');
      return { accepted: true, duplicate: true, id: alertId };
    }
    transaction.create(event, { ...alert, device_id: deviceId, payload_hash: payloadHash, received_at: FieldValue.serverTimestamp() });
    return { accepted: true, duplicate: false, id: alertId };
  });
}

export async function readBody(request) {
  const length = request.headers.get('content-length');
  if (length && (!/^\d+$/.test(length) || Number(length) > MAX_BODY_BYTES)) throw new ApiError(413, 'payload_too_large', 'Maximum payload is 16 KiB');
  if (!request.body) throw new ApiError(400, 'invalid_json', 'JSON body required');
  const reader = request.body.getReader();
  const chunks = []; let size = 0;
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > MAX_BODY_BYTES) {
        await reader.cancel();
        throw new ApiError(413, 'payload_too_large', 'Maximum payload is 16 KiB');
      }
      chunks.push(value);
    }
  } finally { reader.releaseLock(); }
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8')); }
  catch { throw new ApiError(400, 'invalid_json', 'Invalid JSON'); }
}

export async function handleAlert(request, getDatabase) {
  const headers = { 'Cache-Control': 'no-store' };
  try {
    const deviceId = request.headers.get('x-device-id');
    const key = request.headers.get('x-device-key');
    if (!validId(deviceId) || typeof key !== 'string' || !/^[A-Za-z0-9_-]{43}$/.test(key)) {
      throw new ApiError(401, 'invalid_device', 'Invalid device credential');
    }
    if (request.headers.get('content-type')?.split(';')[0].trim().toLowerCase() !== 'application/json') {
      throw new ApiError(415, 'unsupported_media_type', 'Content-Type must be application/json');
    }
    const alert = validateAlert(await readBody(request), deviceId);
    const result = await saveAlert(getDatabase(), deviceId, key, alert);
    return Response.json(result, { status: 200, headers });
  } catch (error) {
    if (error instanceof ApiError) return Response.json({ accepted: false, code: error.code, detail: error.message }, { status: error.status, headers });
    // Do not log request headers, body or service-account credentials.
    console.error('alert_ingestion_failed', { code: String(error?.code || 'unknown') });
    return Response.json({ accepted: false, code: 'temporarily_unavailable', detail: 'Could not persist alert; retry with the same event identity' },
      { status: 503, headers: { ...headers, 'Retry-After': '5' } });
  }
}
