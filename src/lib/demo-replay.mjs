export function isReplayHotkey(event, blocked = false) {
  return !blocked && !event.defaultPrevented && !event.repeat && !event.altKey && !event.ctrlKey && !event.metaKey && !event.shiftKey &&
    (event.code === 'Space' || event.key === ' ');
}
export function replayCandidates(alerts) {
  return alerts.filter(alert => alert.class_id === 1 && !alert.demo_source_id);
}
export function makeDemoAlert(source, id, timestamp) {
  if (!source || source.class_id !== 1 || source.demo_source_id) throw new Error('A historical Class 1 record is required');
  return { ...source, id, received_at: timestamp, demo_source_id: source.id, demo_original_received_at: source.received_at };
}
function time(alert) {
  const value = alert.received_at;
  return value ? (value.seconds || 0) * 1000 + (value.nanoseconds || 0) / 1e6 : 0;
}
export function combineDemoAlerts(live, replay) {
  if (!replay.length) return live;
  return [...replay, ...live].sort((a,b) => time(b)-time(a)).slice(0, 100);
}
