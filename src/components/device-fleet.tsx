'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import type { Timestamp } from 'firebase/firestore';
import { devicePresence } from '@/lib/device-presence.mjs';

export type DeviceSummary = {
  model_update?: { command_id: string; name: string; version: number; status: string; error?: string };
  id: string; name: string; last_heartbeat_at?: Timestamp;
  heartbeat?: { firmware_version: string; uptime_ms: number; wifi_rssi_dbm: number;
    free_heap_bytes: number; outbox_pending: number; outbox_rejected: number;
    outbox_capacity: number; storage_ready: boolean;
    fpga?: { spi_ready: boolean; model_valid: boolean; active_version: number; run_enabled: boolean; protocol_error: number; load_error: number } };
};
const statusLabels = { online: 'Online', delayed: 'Chậm heartbeat', offline: 'Offline', unknown: 'Chưa có heartbeat', unverified: 'Chưa xác minh' };

function uptime(ms?: number) {
  if (!Number.isFinite(ms) || ms === undefined) return '—';
  const minutes = Math.floor(ms / 60000), hours = Math.floor(minutes / 60);
  return hours >= 24 ? `${Math.floor(hours / 24)} ngày ${hours % 24} giờ` : hours ? `${hours} giờ ${minutes % 60} phút` : `${minutes} phút`;
}

export function DeviceFleet({ orgId, devices, cached }: { orgId: string; devices: DeviceSummary[]; cached: boolean }) {
  const [now, setNow] = useState(() => Date.now());
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState('all');
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 10000);
    const refresh = () => setNow(Date.now());
    document.addEventListener('visibilitychange', refresh);
    return () => { clearInterval(timer); document.removeEventListener('visibilitychange', refresh); };
  }, []);
  const rows = devices.map(device => ({ device, status: devicePresence(device.last_heartbeat_at?.toMillis?.(), now, cached) as keyof typeof statusLabels }));
  const visible = rows.filter(({ device, status }) => (filter === 'all' || filter === status) && `${device.id} ${device.name}`.toLowerCase().includes(search.trim().toLowerCase()));
  return <section className="fleet-panel" aria-labelledby="fleet-title">
    <div className="panel-heading"><div><p className="eyebrow">DEVICE FLEET</p><h2 id="fleet-title">Danh sách thiết bị</h2></div><span className="device-chip">{devices.length} thiết bị</span></div>
    <p className="fleet-explanation">Heartbeat mỗi 60 giây. Online trong 90 giây gần nhất; chậm đến 3 phút; quá 3 phút là Offline. Trạng thái phản ánh kết nối ESP32 ↔ server, chưa xác nhận lõi xử lý đang hoạt động.</p>
    {cached ? <p className="notice" role="status">Đang hiển thị dữ liệu lưu đệm. Chờ kết nối server để xác minh trạng thái.</p> : null}
    <div className="fleet-summary" aria-label="Tổng quan kết nối"><span><b>{devices.length}</b> Tổng thiết bị</span><span className="presence-online"><b>{rows.filter(row => row.status === 'online').length}</b> Online</span><span className="presence-delayed"><b>{rows.filter(row => row.status === 'delayed').length}</b> Chậm heartbeat</span><span className="presence-offline"><b>{rows.filter(row => row.status === 'offline').length}</b> Offline</span></div>
    <div className="fleet-filters"><label><span>Tìm thiết bị</span><input type="search" placeholder="Tên hoặc mã thiết bị…" value={search} onChange={event => setSearch(event.target.value)}/></label><label><span>Trạng thái</span><select value={filter} onChange={event => setFilter(event.target.value)}><option value="all">Tất cả trạng thái</option>{Object.entries(statusLabels).map(([value,label]) => <option key={value} value={value}>{label}</option>)}</select></label></div>
    {!visible.length ? <div className="empty"><h3>{devices.length ? 'Không có thiết bị phù hợp' : 'Nhóm chưa có thiết bị'}</h3><p>{devices.length ? 'Thử thay đổi từ khóa hoặc bộ lọc.' : 'Thiết bị sẽ xuất hiện sau khi quản trị viên đăng ký.'}</p></div> : <div className="fleet-grid">{visible.map(({ device, status }) => {
      const telemetry = device.heartbeat;
      const lastSeen = device.last_heartbeat_at?.toDate?.();
      return <article className="fleet-card" key={device.id}>
        <div className="fleet-card-heading"><div><h3>{device.name}</h3><span className="fleet-device-id">{device.id}</span></div><span className={`presence-badge presence-${status}`}>{statusLabels[status]}</span></div>
        <p className="fleet-last-seen">Heartbeat cuối <strong>{lastSeen ? lastSeen.toLocaleString('vi-VN') : 'Chưa nhận'}</strong></p>
        {!telemetry ? <p className="fleet-no-heartbeat">Nạp firmware có heartbeat để bắt đầu theo dõi kết nối.</p> : <>
          <dl className="fleet-metrics"><div><dt>Chờ gửi</dt><dd>{telemetry.outbox_pending} / {telemetry.outbox_capacity}</dd></div><div><dt>Bản ghi cách ly</dt><dd>{telemetry.outbox_rejected}</dd></div><div><dt>Tín hiệu Wi-Fi</dt><dd>{telemetry.wifi_rssi_dbm} dBm</dd></div><div><dt>Thời gian ESP chạy</dt><dd>{uptime(telemetry.uptime_ms)}</dd></div><div><dt>Heap còn trống</dt><dd>{Math.round(telemetry.free_heap_bytes / 1024)} KiB</dd></div><div><dt>Outbox storage</dt><dd className={telemetry.storage_ready ? '' : 'danger'}>{telemetry.storage_ready ? 'Sẵn sàng' : 'Bị chặn'}</dd></div></dl>
          {telemetry.storage_ready === false || telemetry.outbox_rejected > 0 || telemetry.outbox_pending + telemetry.outbox_rejected >= telemetry.outbox_capacity ? <p className="fleet-warning">{!telemetry.storage_ready ? 'Storage lỗi: cảnh báo từ lõi xử lý có thể chưa được lưu và xác nhận.' : telemetry.outbox_pending + telemetry.outbox_rejected >= telemetry.outbox_capacity ? 'Outbox đã đầy. Kiểm tra kết nối và các bản ghi cách ly.' : 'Có bản ghi cách ly cần kiểm tra trên thiết bị.'}</p> : null}
          <p className="fleet-firmware">Firmware <code>{telemetry.firmware_version}</code><span>Số liệu tại heartbeat cuối</span></p>
        </>}
        <Link className="fleet-open" href={`/dashboard?org=${encodeURIComponent(orgId)}&device=${encodeURIComponent(device.id)}`}>Xem cảnh báo</Link>
      </article>;
    })}</div>}
    <p className="fleet-bottom" role="status">Hiển thị {visible.length} / {devices.length} thiết bị · Trạng thái được tính lại mỗi 10 giây</p>
  </section>;
}
