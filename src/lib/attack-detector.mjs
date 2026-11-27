function receivedAt(alert) {
  const timestamp = alert.received_at;
  if (!timestamp || !Number.isSafeInteger(timestamp.seconds) || !Number.isInteger(timestamp.nanoseconds) || timestamp.nanoseconds < 0 || timestamp.nanoseconds >= 1e9) return null;
  return BigInt(timestamp.seconds) * 1000000000n + BigInt(timestamp.nanoseconds);
}

// One detector per listener/device. Cached or initial historical records never
// trigger a flash, nor do old records backfilled when another alert is deleted.
export function createAttackDetector() {
  let initialized = false;
  let watermark = null;
  let idsAtWatermark = new Set();
  return (alerts, fromCache) => {
    if (fromCache) return 0;
    let attacks = 0;
    let maximum = watermark;
    const timed = alerts.map(alert => ({ alert, time: receivedAt(alert) })).filter(item => item.time !== null);
    for (const { alert, time } of timed) {
      if (initialized && alert.class_id === 1 && (watermark === null || time > watermark || (time === watermark && !idsAtWatermark.has(alert.id)))) attacks++;
      if (maximum === null || time > maximum) maximum = time;
    }
    if (maximum !== watermark) idsAtWatermark = new Set();
    for (const { alert, time } of timed) if (time === maximum) idsAtWatermark.add(alert.id);
    watermark = maximum;
    initialized = true;
    return attacks;
  };
}
