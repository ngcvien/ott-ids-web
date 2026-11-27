import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { parseGwm, createGwm, decodeGwmBase64, storedGwm } from '../src/server/gwm-format.mjs';
import { packModel } from '../src/server/model-format.mjs';

const bytes = await readFile(new URL('../public/models/gateway24_model2_5s_v02000001.gwm', import.meta.url));
const releaseHash = '291bd477354327447258c17139ded1933f40c7dcf4afbd6a1b716eb2ed857fd1';
const invalid = error => error.status === 422;
test('supplied GWM artifact matches release SHA, header and the existing 71-node ROM', async () => {
  const { model, artifact } = parseGwm(bytes, releaseHash.toUpperCase());
  assert.equal(bytes.length, 648);
  assert.equal(artifact.artifact_sha256, releaseHash);
  assert.equal(artifact.feature_count, 24); assert.equal(artifact.window_ms, 5000);
  assert.equal(artifact.payload_length, 568);
  assert.equal(model.version, 0x02000001); assert.equal(model.node_count, 71);
  assert.equal(model.crc32, '44124ea7');
  assert.equal(model.sha256, 'c26dd8cf58278f33fec4cc22dc4d3190ada7fc4f27aa986eb62e96e91d95dad3');
  assert.deepEqual(model, JSON.parse(await readFile(new URL('../public/models/gateway24-model2.json', import.meta.url), 'utf8')));
  assert.deepEqual(createGwm(model), bytes);
});
test('GWM rejects incompatible headers, counts, feature/window contracts, flags and reserved bytes', () => {
  const highBitMagic = Buffer.from(bytes); highBitMagic[0] |= 0x80;
  assert.throws(() => parseGwm(highBitMagic),invalid);
  for (const offset of [0,8,10,12,14,20,22,24,28,32,36,40,72,79]) {
    const damaged = Buffer.from(bytes); damaged[offset] ^= 1;
    assert.throws(() => parseGwm(damaged), invalid, `offset ${offset}`);
  }
  for (const count of [0,128]) { const damaged = Buffer.from(bytes); damaged.writeUInt16BE(count,20); assert.throws(() => parseGwm(damaged), invalid); }
  for (const damaged of [bytes.subarray(0,79), bytes.subarray(0,647), Buffer.concat([bytes,Buffer.from([0])]), Buffer.alloc(1097)]) assert.throws(() => parseGwm(damaged), invalid);
});
test('artifact SHA binds header as well as payload; payload corruption fails without an external hash', () => {
  const changedVersion = Buffer.from(bytes); changedVersion.writeUInt32BE(0x02000002,16);
  assert.equal(parseGwm(changedVersion).model.version, 0x02000002);
  assert.throws(() => parseGwm(changedVersion,releaseHash), invalid);
  const corrupt = Buffer.from(bytes); corrupt[80] ^= 1;
  assert.throws(() => parseGwm(corrupt), invalid);
  assert.throws(() => parseGwm(bytes,'not-a-sha'), invalid);
});
test('GWM base64 is bounded and canonical; stored core and artifact must agree', () => {
  const encoded = bytes.toString('base64');
  assert.deepEqual(decodeGwmBase64(encoded,releaseHash).bytes,bytes);
  for (const value of ['',encoded+'\n','?'.repeat(32),'A'.repeat(1468)]) assert.throws(() => decodeGwmBase64(value), invalid);
  assert.throws(() => storedGwm({ model: packModel(['0000000000000000'],1), artifact_base64: encoded }), invalid);
});
test('legacy stored models become deterministic GWM artifacts with uint64 LE words intact', () => {
  for (const count of [1,127]) {
    const model = packModel(Array(count).fill('fedcba9876543210'),0xffffffff);
    const converted = storedGwm({model});
    assert.deepEqual(converted.model,model);
    assert.equal(converted.bytes.length,80+count*8);
    assert.equal(converted.bytes.subarray(80,88).toString('hex'),'1032547698badcfe');
    assert.equal(converted.artifact.artifact_sha256,createHash('sha256').update(converted.bytes).digest('hex'));
  }
});
