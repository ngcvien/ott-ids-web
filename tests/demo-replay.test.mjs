import { test } from 'node:test';
import assert from 'node:assert/strict';
import { combineDemoAlerts, isReplayHotkey, makeDemoAlert, replayCandidates } from '../src/lib/demo-replay.mjs';
import { alertDetailExport } from '../src/lib/alert-details.mjs';
import { summarizeAlerts } from '../src/lib/alert-analytics.mjs';

const timestamp = ms => ({ seconds: Math.floor(ms/1000), nanoseconds: ms%1000*1e6, toDate: () => new Date(ms) });
const source = { id: 'original-id', class_id: 1, action: 'monitor', src_ip: '192.0.2.1', dst_ip: '192.0.2.2',
  protocol: 17, event_id: '18446744073709551615', model_version: 2, received_at: timestamp(100000) };
test('plain Space is recognized, while editing/dialogs, held keys, modifiers and consumed events are ignored', () => {
  assert.equal(isReplayHotkey({ key: ' ' }), true);
  assert.equal(isReplayHotkey({ code: 'Space' }), true);
  assert.equal(isReplayHotkey({ code: 'Space' }, true), false);
  for (const flag of ['repeat', 'defaultPrevented', 'altKey', 'ctrlKey', 'metaKey', 'shiftKey']) assert.equal(isReplayHotkey({ code: 'Space', [flag]: true }), false);
  assert.equal(isReplayHotkey({ key: 'Enter' }), false);
});
test('only historical Class 1 records seed replay; replay never recursively seeds itself', () => {
  const replay = makeDemoAlert(source, 'demo-1', timestamp(200000));
  assert.deepEqual(replayCandidates([source, { id: 'other', class_id: 0 }, replay]), [source]);
  assert.throws(() => makeDemoAlert({ class_id: 0 }, 'demo-2', timestamp(200000)));
  assert.throws(() => makeDemoAlert(replay, 'demo-2', timestamp(200000)));
});
test('replay keeps historical classification, action and uint64 identity, with a distinct local ID and explicit simulated time', () => {
  const before = JSON.stringify(source);
  const replay = makeDemoAlert(source, 'demo-unique', timestamp(200000));
  assert.equal(replay.demo_source_id, source.id); assert.equal(replay.id, 'demo-unique');
  assert.equal(replay.class_id, 1); assert.equal(replay.action, 'monitor');
  assert.equal(replay.event_id, '18446744073709551615');
  assert.equal(replay.demo_original_received_at, source.received_at);
  assert.equal(replay.received_at.seconds, 200);
  assert.equal(JSON.stringify(source), before);
});
test('combined view is bounded and sorted, leaving real alerts unchanged; empty replay restores real data exactly', () => {
  const live = Array.from({ length: 100 }, (_,i) => ({ ...source, id: `real-${i}`, received_at: timestamp(100000+i*1000) }));
  const before = JSON.stringify(live);
  const replay = makeDemoAlert(source, 'demo-top', timestamp(300000));
  const combined = combineDemoAlerts(live, [replay]);
  assert.equal(combined.length, 100); assert.equal(combined[0], replay);
  assert.equal(JSON.stringify(live), before);
  assert.equal(combineDemoAlerts(live, []), live);
});
test('demo detail JSON distinguishes original server time from generated display time and excludes internal hashes', () => {
  const replay = makeDemoAlert({ ...source, payload_hash: 'private' }, 'demo-1', timestamp(200000));
  const exported = alertDetailExport(replay, 'org', 'device');
  assert.equal(exported.received_at, new Date(100000).toISOString());
  assert.deepEqual(exported.demo, { simulated: true, source_alert_id: source.id, displayed_at: new Date(200000).toISOString() });
  assert.equal('payload_hash' in exported, false);
  assert.equal('demo' in alertDetailExport(source, 'org', 'device'), false);
});
test('charts update from local replay without mutating the underlying dataset', () => {
  const local = makeDemoAlert(source, 'demo-1', timestamp(200000));
  const data = summarizeAlerts(combineDemoAlerts([source], [local]), 'sample', 200000);
  assert.equal(data.total, 2); assert.equal(data.attacks, 2);
  assert.equal(summarizeAlerts([source], 'sample', 200000).total, 1);
});
