export const HEARTBEAT_ONLINE_MS = 90000;
export const HEARTBEAT_OFFLINE_MS = 180000;

// Missing heartbeats are unknown, never silently assumed to be offline.
// Cached data cannot establish the current health of the device/server connection.
export function devicePresence(lastSeenMs, nowMs, cached = false) {
  if (!Number.isFinite(lastSeenMs) || lastSeenMs <= 0) return 'unknown';
  if (cached || !Number.isFinite(nowMs) || lastSeenMs - nowMs > 60000) return 'unverified';
  const age = Math.max(0, nowMs - lastSeenMs);
  if (age <= HEARTBEAT_ONLINE_MS) return 'online';
  if (age <= HEARTBEAT_OFFLINE_MS) return 'delayed';
  return 'offline';
}
