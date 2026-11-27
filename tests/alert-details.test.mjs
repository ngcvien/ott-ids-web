import { test } from 'node:test';
import assert from 'node:assert/strict';
import { actionDetails, alertDetailExport, classificationDetails, modelHex, protocolLabel, transportPort } from '../src/lib/alert-details.mjs';

test('Class 1 is an attack, while other classes are not assigned invented normal/attack meanings', () => {
  assert.deepEqual(classificationDetails(1), { label: 'Tấn công · Class 1', attack: true });
  assert.deepEqual(classificationDetails(0), { label: 'Class 0', attack: false });
  assert.equal(classificationDetails(63).label, 'Class 63');
  assert.equal(classificationDetails(undefined).label, 'Chưa có phân loại');
});
test('classification alone never implies blocked traffic; unknown actions do not claim Drop', () => {
  assert.equal(actionDetails('monitor').tone, 'monitor');
  assert.match(actionDetails('monitor').description, /không đồng nghĩa/);
  assert.equal(actionDetails('drop').tone, 'drop');
  assert.match(actionDetails('drop').description, /không phải lệnh chặn do web/);
  assert.equal(actionDetails(undefined).tone, 'unknown');
  assert.equal(actionDetails('invalid').tone, 'unknown');
});
test('non-TCP/UDP traffic has no invented transport port, and zero is retained for real transport ports', () => {
  assert.equal(transportPort(1, 12345), 'Không áp dụng');
  assert.equal(transportPort(0, 0), 'Không áp dụng');
  assert.equal(transportPort(17, 0), '0');
  assert.equal(transportPort(6, 65535), '65535');
  assert.equal(transportPort(undefined, 80), '—');
  assert.equal(protocolLabel(1), 'ICMP');
  assert.equal(protocolLabel(0), 'IP protocol 0');
  assert.equal(protocolLabel(undefined), '—');
});
test('model formatting preserves all 32 bits and distinguishes missing data from zero', () => {
  assert.equal(modelHex(0), '0x00000000');
  assert.equal(modelHex(0xffffffff), '0xFFFFFFFF');
  assert.equal(modelHex(16777217), '0x01000001');
  assert.equal(modelHex(undefined), '—');
  assert.equal(modelHex(-1), '—');
});
test('detail JSON preserves u64 event identity and FPGA counter, uses server time and excludes internal fields', () => {
  const record = { id: 'doc-id', device_id: 'untrusted-value', event_id: '18446744073709551615', boot_id: 'original-boot',
    timestamp_ms: 0, model_version: 0, src_port: 0, tree_error: 0, payload_hash: 'private-hash',
    future_private_field: 'do not copy', received_at: { toDate: () => new Date('2026-11-27T12:00:00.000Z') } };
  const exported = JSON.parse(JSON.stringify(alertDetailExport(record, 'org-a', 'IDS-0001')));
  assert.equal(exported.event_id, '18446744073709551615');
  assert.equal(exported.timestamp_ms, 0); assert.equal(exported.tree_error, 0);
  assert.equal(exported.device_id, 'IDS-0001'); assert.equal(exported.organization_id, 'org-a');
  assert.equal(exported.received_at, '2026-11-27T12:00:00.000Z');
  assert.equal('payload_hash' in exported, false); assert.equal('future_private_field' in exported, false);
  assert.equal(alertDetailExport({ id: 'missing-time' }, 'org-a', 'IDS-0001').received_at, null);
});
