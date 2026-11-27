import { FieldValue } from 'firebase-admin/firestore';
import { ApiError, readBody, validId } from './alerts.mjs';

export function validateClearRequest(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body) ||
      Object.keys(body).some(key => !['orgId', 'deviceId', 'ids'].includes(key)) ||
      !validId(body.orgId) || !validId(body.deviceId) || !Array.isArray(body.ids) ||
      body.ids.length < 1 || body.ids.length > 100 || body.ids.some(id => !validId(id)) ||
      new Set(body.ids).size !== body.ids.length) {
    throw new ApiError(422, 'invalid_clear_request', 'Supply orgId, deviceId and 1–100 unique alert IDs');
  }
  return body;
}

export async function clearAlerts(db, uid, input) {
  const { orgId, deviceId, ids } = validateClearRequest(input);
  if (!validId(uid)) throw new ApiError(401, 'unauthorized', 'Sign in required');
  return db.runTransaction(async transaction => {
    const member = await transaction.get(db.doc(`organizations/${orgId}/members/${uid}`));
    if (member.data()?.role !== 'owner') throw new ApiError(403, 'owner_required', 'Only an organization owner may clear alerts');
    const device = db.doc(`organizations/${orgId}/devices/${deviceId}`);
    if (!(await transaction.get(device)).exists) throw new ApiError(404, 'device_not_found', 'Device not found');
    const alerts = await transaction.getAll(...ids.map(id => device.collection('alerts').doc(id)));
    let cleared = 0;
    for (const alert of alerts) {
      if (!alert.exists) continue;
      const hash = alert.data().payload_hash;
      if (typeof hash !== 'string' || !/^[a-f0-9]{64}$/.test(hash)) {
        throw new ApiError(409, 'invalid_stored_alert', 'Alert has no valid deduplication hash; contact an administrator');
      }
      // Keep only identity/hash metadata, not the deleted IP/packet data. A late
      // ESP retry must still receive duplicate=true instead of recreating history.
      transaction.set(device.collection('alertReceipts').doc(alert.id), {
        payload_hash: hash, cleared_at: FieldValue.serverTimestamp(),
      });
      transaction.delete(alert.ref);
      cleared++;
    }
    return { cleared };
  });
}

export async function handleClear(request, getDatabase, verifyToken) {
  const headers = { 'Cache-Control': 'no-store' };
  try {
    const authorization = request.headers.get('authorization') || '';
    if (!authorization.startsWith('Bearer ') || authorization.length <= 7 || authorization.length > 8192) {
      throw new ApiError(401, 'unauthorized', 'Sign in required');
    }
    let user;
    try { user = await verifyToken(authorization.slice(7)); }
    catch (error) {
      if (String(error?.code || '').startsWith('auth/') && !['auth/internal-error', 'auth/insufficient-permission'].includes(error.code)) {
        throw new ApiError(401, 'unauthorized', 'Invalid or expired session');
      }
      throw error;
    }
    if (request.headers.get('content-type')?.split(';')[0].trim().toLowerCase() !== 'application/json') {
      throw new ApiError(415, 'unsupported_media_type', 'Content-Type must be application/json');
    }
    const input = validateClearRequest(await readBody(request));
    const result = await clearAlerts(getDatabase(), user.uid, input);
    return Response.json(result, { headers });
  } catch (error) {
    if (error instanceof ApiError) return Response.json({ code: error.code, detail: error.message }, { status: error.status, headers });
    console.error('alert_clear_failed', { code: String(error?.code || 'unknown') });
    return Response.json({ code: 'temporarily_unavailable', detail: 'Could not clear alerts; please retry' }, { status: 503, headers });
  }
}
