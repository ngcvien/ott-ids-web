import { test } from 'node:test';
import assert from 'node:assert/strict';
import { summarizeAlerts } from '../src/lib/alert-analytics.mjs';

const now = Date.UTC(2026, 10, 27, 12, 0, 0);
function event(ms, fields = {}) {
  const seconds = Math.floor(ms / 1000);
  return { received_at: { seconds, nanoseconds: Math.round((ms - seconds * 1000) * 1e6) }, ...fields };
}
test('empty data has no invented percentages or traffic and still returns a valid time axis', () => {
  const data = summarizeAlerts([], 'sample', now);
  assert.equal(data.total, 0); assert.equal(data.attackPercent, 0); assert.equal(data.protocols.length, 0);
  assert.equal(data.buckets.length, 12); assert.ok(data.end > data.start);
  assert.equal(data.buckets.every(bucket => bucket.total === 0), true);
});
test('sample mode includes old records without depending on the viewer clock and counts each event once', () => {
  const alerts = [event(now - 86400000), event(now - 43200000), event(now)];
  const data = summarizeAlerts(alerts, 'sample', now + 864000000);
  assert.equal(data.total, 3); assert.equal(data.buckets.reduce((sum, bucket) => sum + bucket.total, 0), 3);
  assert.equal(data.buckets[0].total, 1); assert.equal(data.buckets[11].total, 1);
  assert.equal(summarizeAlerts(alerts, 'toString', now).total, 3);
});
test('relative ranges include start/now boundaries and exclude old and future records', () => {
  const alerts = [event(now-900001), event(now-900000), event(now), event(now+1000)];
  const data = summarizeAlerts(alerts, '15m', now);
  assert.equal(data.total, 2); assert.equal(data.buckets.reduce((sum,bucket) => sum+bucket.total, 0), 2);
  assert.equal(summarizeAlerts(alerts, '15m', now+1000000).total, 0);
});
test('Class 1 detection and Drop actions stay distinct; protocol totals and class totals reconcile', () => {
  const alerts = [event(now, { class_id: 1, action: 'monitor', protocol: 17 }),
    event(now, { class_id: 0, action: 'drop', protocol: 6 }), event(now, { class_id: 63, protocol: 1 }),
    event(now, { protocol: 0 }), event(now, { class_id: -1, protocol: -2 })];
  const data = summarizeAlerts(alerts, 'sample', now);
  assert.equal(data.total, 5); assert.equal(data.attacks, 1); assert.equal(data.attackPercent, 20);
  assert.equal(data.otherClasses, 2); assert.equal(data.unknownClasses, 2);
  assert.equal(data.buckets[11].drops, 1); assert.equal(data.buckets[11].monitor, 1);
  assert.equal(data.protocols.reduce((sum, protocol) => sum+protocol.count, 0), 5);
  assert.equal(data.protocols.find(protocol => protocol.key === 'unknown').count, 1);
  assert.equal(data.protocols.find(protocol => protocol.key === 'other').count, 1);
});
test('invalid receive timestamps are excluded explicitly and the input is not mutated', () => {
  const alerts = [event(now, { class_id: 1 }), { received_at: null }, { received_at: { seconds: NaN, nanoseconds: 0 } },
    { received_at: { seconds: 1, nanoseconds: 1e9 } }];
  const before = JSON.stringify(alerts);
  const data = summarizeAlerts(alerts, 'sample', now);
  assert.equal(data.total, 1); assert.equal(data.ignored, 3); assert.equal(data.attackPercent, 100);
  assert.equal(JSON.stringify(alerts), before);
});
test('equal timestamps and all 100 events fit inside the 12 buckets without overflow', () => {
  const data = summarizeAlerts(Array.from({ length: 100 }, () => event(now, { class_id: 1, protocol: 17 })), 'sample', now);
  assert.equal(data.total, 100); assert.equal(data.buckets[11].total, 100);
  assert.equal(data.buckets.reduce((sum,bucket) => sum+bucket.total, 0), 100);
  assert.equal(data.attackPercent, 100);
});
