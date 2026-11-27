import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createAttackDetector } from '../src/lib/attack-detector.mjs';

const event = (id, seconds, classId = 1, nanoseconds = 0) => ({ id, class_id: classId, received_at: { seconds, nanoseconds } });
test('initial cache and initial server history never flash', () => {
  const detect = createAttackDetector();
  assert.equal(detect([event('old', 10)], true), 0);
  assert.equal(detect([event('old', 10), event('also-old', 20)], false), 0);
  assert.equal(detect([event('old', 10), event('also-old', 20)], false), 0);
});
test('only a new Class 1 record triggers attention; metadata/repeated snapshots do not', () => {
  const detect = createAttackDetector();
  detect([], false);
  assert.equal(detect([event('normal', 10, 0)], false), 0);
  const incoming = [event('attack', 20), event('normal', 10, 0)];
  assert.equal(detect(incoming, true), 0);
  assert.equal(detect(incoming, false), 1);
  assert.equal(detect(incoming, false), 0);
});
test('deletion, backfill, or reappearance of old records does not flash', () => {
  const detect = createAttackDetector();
  detect([event('latest', 50)], false);
  assert.equal(detect([event('older', 40)], false), 0);
  assert.equal(detect([event('latest', 50)], false), 0);
  assert.equal(detect([], false), 0);
  assert.equal(detect([event('new', 60)], false), 1);
});
test('nanosecond precision and multiple attacks in one snapshot are retained', () => {
  const detect = createAttackDetector();
  detect([event('initial', 1700000000, 1, 1)], false);
  assert.equal(detect([event('next', 1700000000, 1, 2), event('same-time', 1700000000, 1, 2)], false), 2);
  assert.equal(detect([event('next', 1700000000, 1, 2), event('same-time', 1700000000, 1, 2)], false), 0);
});
test('invalid timestamps are ignored; a new detector establishes its own history baseline', () => {
  const detect = createAttackDetector();
  assert.equal(detect([{ id: 'bad', class_id: 1 }], false), 0);
  assert.equal(detect([event('live', 30)], false), 1);
  assert.equal(createAttackDetector()([event('live', 30)], false), 0);
});
