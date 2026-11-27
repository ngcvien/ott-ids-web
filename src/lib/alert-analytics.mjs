const WINDOWS = { '15m': 15 * 60000, '1h': 3600000, '24h': 86400000 };
function receivedMillis(alert) {
  const time = alert.received_at;
  if (!time || !Number.isSafeInteger(time.seconds) || !Number.isInteger(time.nanoseconds) || time.nanoseconds < 0 || time.nanoseconds >= 1e9) return null;
  const value = time.seconds * 1000 + time.nanoseconds / 1e6;
  return Number.isFinite(value) && Math.abs(value) <= 8640000000000000 ? value : null;
}

export function summarizeAlerts(alerts, range = 'sample', now = Date.now()) {
  const dated = alerts.map(alert => ({ alert, time: receivedMillis(alert) })).filter(item => item.time !== null);
  const latest = dated.length ? Math.max(...dated.map(item => item.time)) : now;
  const earliest = dated.length ? Math.min(...dated.map(item => item.time)) : now;
  const duration = Object.hasOwn(WINDOWS, range) ? WINDOWS[range] : undefined;
  const end = duration ? now + 1 : latest + 1;
  const start = duration ? now - duration : end - Math.max(60000, latest - earliest + 1);
  const width = (end - start) / 12;
  const buckets = Array.from({ length: 12 }, (_, index) => ({ start: start + index * width, end: start + (index+1) * width, total: 0, attacks: 0, drops: 0, monitor: 0 }));
  const protocols = [
    { label: 'TCP', count: 0, key: 'tcp' }, { label: 'UDP', count: 0, key: 'udp' },
    { label: 'ICMP', count: 0, key: 'icmp' }, { label: 'Khác', count: 0, key: 'other' },
    { label: 'Chưa rõ', count: 0, key: 'unknown' },
  ];
  let total = 0, attacks = 0, otherClasses = 0, unknownClasses = 0;
  for (const { alert, time } of dated) {
    if (time < start || time >= end) continue;
    const index = Math.min(11, Math.max(0, Math.floor((time - start) / width)));
    const bucket = buckets[index];
    total++; bucket.total++;
    if (alert.class_id === 1) { attacks++; bucket.attacks++; }
    else if (Number.isInteger(alert.class_id) && alert.class_id >= 0 && alert.class_id <= 63) otherClasses++;
    else unknownClasses++;
    if (alert.action === 'drop') bucket.drops++;
    if (alert.action === 'monitor') bucket.monitor++;
    protocols[alert.protocol === 6 ? 0 : alert.protocol === 17 ? 1 : alert.protocol === 1 ? 2 : Number.isInteger(alert.protocol) && alert.protocol >= 0 && alert.protocol <= 255 ? 3 : 4].count++;
  }
  return { buckets, protocols: protocols.filter(protocol => protocol.count > 0).sort((a,b) => b.count-a.count || a.label.localeCompare(b.label)),
    total, attacks, otherClasses, unknownClasses, attackPercent: total ? attacks / total * 100 : 0,
    ignored: alerts.length - dated.length, start, end };
}
