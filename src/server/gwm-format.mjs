import { createHash } from 'node:crypto';
import { ApiError } from './alerts.mjs';
import { crc32, modelBytes, packModel, validateModel } from './model-format.mjs';

export const GWM_HEADER_SIZE = 80;
export const GWM_MAX_SIZE = 80 + 127 * 8;
export const GWM_MEDIA_TYPE = 'application/vnd.gateway24.model';
const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
const invalid = detail => { throw new ApiError(422, 'invalid_gwm', detail); };

export function parseGwm(bytes, expectedHash) {
  if (!Buffer.isBuffer(bytes)) bytes = Buffer.from(bytes);
  if (bytes.length < 88 || bytes.length > GWM_MAX_SIZE) invalid('GWM size must be 88–1096 bytes');
  if (!bytes.subarray(0, 8).equals(Buffer.from('GW24MODL', 'ascii'))) invalid('Invalid GW24MODL magic');
  if (bytes.readUInt16BE(8) !== 1 || bytes.readUInt16BE(10) !== GWM_HEADER_SIZE) invalid('Expected GWM v1 with 80-byte header');
  if (bytes.readUInt16BE(12) !== 1 || bytes.readUInt16BE(14) !== 64) invalid('Expected model ABI 1, 64-bit words');
  const version = bytes.readUInt32BE(16), count = bytes.readUInt16BE(20);
  const featureCount = bytes.readUInt16BE(22), windowMs = bytes.readUInt32BE(24);
  const payloadLength = bytes.readUInt32BE(28), flags = bytes.readUInt32BE(36);
  if (count < 1 || count > 127 || payloadLength !== count * 8 || bytes.length !== GWM_HEADER_SIZE + payloadLength) invalid('Invalid node count or payload/file length');
  if (featureCount !== 24 || windowMs !== 5000) invalid('Expected Gateway24 24-feature, 5000-ms flow contract');
  if (flags !== 1 || bytes.subarray(72, 80).some(byte => byte !== 0)) invalid('Unsupported flags or nonzero reserved bytes');
  const artifactHash = sha256(bytes);
  if (expectedHash !== undefined && (typeof expectedHash !== 'string' || !/^[a-fA-F0-9]{64}$/.test(expectedHash) || expectedHash.toLowerCase() !== artifactHash)) invalid('Artifact SHA-256 mismatch');
  const payload = bytes.subarray(80);
  const expectedCrc = bytes.readUInt32BE(32).toString(16).padStart(8, '0');
  const payloadHash = bytes.subarray(40, 72).toString('hex');
  if (crc32(payload) !== expectedCrc || sha256(payload) !== payloadHash) invalid('Payload CRC32/SHA-256 mismatch');
  const words = Array.from({ length: count }, (_, index) => payload.readBigUInt64LE(index * 8).toString(16).padStart(16, '0'));
  const model = packModel(words, version);
  return { model, artifact: { format: 'gateway24-gwm', format_version: 1, header_size: 80,
    word_bits: 64, feature_count: featureCount, window_ms: windowMs, flags,
    payload_length: payloadLength, artifact_size: bytes.length, artifact_sha256: artifactHash } };
}
export function decodeGwmBase64(encoded, expectedHash) {
  if (typeof encoded !== 'string' || !encoded.length || encoded.length > Math.ceil(GWM_MAX_SIZE/3)*4 ||
      !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(encoded)) invalid('Invalid artifact base64');
  const bytes = Buffer.from(encoded, 'base64');
  if (bytes.toString('base64') !== encoded) invalid('Non-canonical base64');
  return { ...parseGwm(bytes, expectedHash), bytes };
}
export function createGwm(input) {
  const model = validateModel(input), payload = modelBytes(model.words);
  const bytes = Buffer.alloc(GWM_HEADER_SIZE + payload.length);
  bytes.write('GW24MODL', 0, 'ascii');
  bytes.writeUInt16BE(1, 8); bytes.writeUInt16BE(80, 10); bytes.writeUInt16BE(1, 12); bytes.writeUInt16BE(64, 14);
  bytes.writeUInt32BE(model.version, 16); bytes.writeUInt16BE(model.node_count, 20); bytes.writeUInt16BE(24, 22);
  bytes.writeUInt32BE(5000, 24); bytes.writeUInt32BE(payload.length, 28); bytes.writeUInt32BE(parseInt(model.crc32, 16), 32);
  bytes.writeUInt32BE(1, 36); Buffer.from(model.sha256, 'hex').copy(bytes, 40); payload.copy(bytes, 80);
  return bytes;
}

export function storedGwm(record) {
  const model = validateModel(record.model);
  const result = record.artifact_base64 ? decodeGwmBase64(record.artifact_base64, record.artifact?.artifact_sha256) :
    (() => { const bytes = createGwm(model); return { ...parseGwm(bytes), bytes }; })();
  if (JSON.stringify(result.model) !== JSON.stringify(model)) invalid('Artifact does not match immutable model');
  return result;
}
