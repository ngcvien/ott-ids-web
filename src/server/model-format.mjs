import { createHash } from 'node:crypto';
import { ApiError } from './alerts.mjs';

export const MODEL_ABI = 1;
export const MAX_MODEL_NODES = 127;
export function crc32(bytes) {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0);
  }
  return ((~crc) >>> 0).toString(16).padStart(8, '0');
}
export function modelBytes(words) {
  const bytes = Buffer.alloc(words.length * 8);
  words.forEach((word, i) => bytes.writeBigUInt64LE(BigInt(`0x${word}`), i * 8));
  return bytes;
}
export function packModel(words, version) {
  const normalized = words.map(word => word.toLowerCase());
  const bytes = modelBytes(normalized);
  return { format: 'ott-ids-model', abi: MODEL_ABI, version, node_count: normalized.length,
    words: normalized, crc32: crc32(bytes), sha256: createHash('sha256').update(bytes).digest('hex') };
}
export function validateModel(input) {
  const invalid = detail => { throw new ApiError(422, 'invalid_model', detail); };
  if (!input || typeof input !== 'object' || Array.isArray(input)) invalid('Model must be an object');
  const fields = ['format', 'abi', 'version', 'node_count', 'words', 'crc32', 'sha256'];
  if (Object.keys(input).some(key => !fields.includes(key))) invalid('Unknown model field');
  if (input.format !== 'ott-ids-model' || input.abi !== MODEL_ABI) invalid('Expected ott-ids-model ABI 1');
  if (!Number.isSafeInteger(input.version) || input.version < 0 || input.version > 0xffffffff) invalid('Version must be uint32');
  if (!Number.isInteger(input.node_count) || input.node_count < 1 || input.node_count > MAX_MODEL_NODES ||
      !Array.isArray(input.words) || input.words.length !== input.node_count ||
      input.words.some(word => typeof word !== 'string' || !/^[a-fA-F0-9]{16}$/.test(word))) invalid('Expected 1–127 hexadecimal 64-bit words');
  if (typeof input.crc32 !== 'string' || !/^[a-fA-F0-9]{8}$/.test(input.crc32) ||
      typeof input.sha256 !== 'string' || !/^[a-fA-F0-9]{64}$/.test(input.sha256)) invalid('CRC32 and SHA-256 required');
  const model = packModel(input.words, input.version);
  if (input.crc32.toLowerCase() !== model.crc32 || input.sha256.toLowerCase() !== model.sha256) invalid('Model checksum mismatch');
  return model;
}
export const modelIdFor = model => createHash('sha256').update(JSON.stringify(model)).digest('hex');
