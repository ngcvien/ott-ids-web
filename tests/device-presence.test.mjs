import { test } from 'node:test';
import assert from 'node:assert/strict';
import { devicePresence } from '../src/lib/device-presence.mjs';

const now = 1800000000000;
test('presence ages from online to delayed to offline even without another snapshot', () => {
  assert.equal(devicePresence(now, now), 'online');
  assert.equal(devicePresence(now, now + 90000), 'online');
  assert.equal(devicePresence(now, now + 90001), 'delayed');
  assert.equal(devicePresence(now, now + 180000), 'delayed');
  assert.equal(devicePresence(now, now + 180001), 'offline');
});
test('missing heartbeat, cached snapshots and unreasonable clock skew never assert online', () => {
  for (const value of [undefined, null, NaN, 0, -1]) assert.equal(devicePresence(value, now), 'unknown');
  assert.equal(devicePresence(now, now, true), 'unverified');
  assert.equal(devicePresence(now + 60001, now), 'unverified');
  assert.equal(devicePresence(now + 1000, now), 'online');
  assert.equal(devicePresence(now, NaN), 'unverified');
});
