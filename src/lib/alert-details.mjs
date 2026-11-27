export function classificationDetails(classId) {
  if (classId === 1) return { label: 'Tấn công · Class 1', attack: true };
  return { label: Number.isInteger(classId) ? `Class ${classId}` : 'Chưa có phân loại', attack: false };
}

export function actionDetails(action) {
  if (action === 'drop') return { label: 'Drop · FPGA báo chặn', tone: 'drop',
    description: 'Bản ghi từ FPGA có hành động Drop. Đây là hành động được thiết bị báo tại sự kiện này, không phải lệnh chặn do web gửi.' };
  if (action === 'monitor') return { label: 'Monitor · Ghi nhận', tone: 'monitor',
    description: 'Sự kiện được ghi nhận ở chế độ Monitor. Phân loại tấn công không đồng nghĩa gói tin đã bị chặn.' };
  return { label: 'Chưa xác định', tone: 'unknown', description: 'Bản ghi chưa có hành động hợp lệ để kết luận Monitor hay Drop.' };
}

export function protocolLabel(protocol) {
  return ({ 1: 'ICMP', 6: 'TCP', 17: 'UDP' })[protocol] || (Number.isInteger(protocol) ? `IP protocol ${protocol}` : '—');
}

export function transportPort(protocol, port) {
  if (!Number.isInteger(protocol)) return '—';
  if (![6, 17].includes(protocol)) return 'Không áp dụng';
  return Number.isInteger(port) ? String(port) : '—';
}

export function modelHex(value) {
  return Number.isSafeInteger(value) && value >= 0 && value <= 0xffffffff ? `0x${value.toString(16).padStart(8, '0').toUpperCase()}` : '—';
}

export function alertDetailExport(alert, orgId, deviceId) {
  const fields = ['boot_id', 'event_id', 'timestamp_ms', 'model_version', 'class_id', 'ingress_port',
    'src_ip', 'dst_ip', 'src_port', 'dst_port', 'protocol', 'action', 'tree_error', 'tree_steps', 'latency_cycles'];
  // Allowlist excludes internal deduplication hashes and any future private metadata.
  const data = { organization_id: orgId, device_id: deviceId, alert_id: alert.id };
  for (const field of fields) if (alert[field] !== undefined) data[field] = alert[field];
  data.received_at = alert.received_at?.toDate?.().toISOString() ?? null;
  return data;
}
