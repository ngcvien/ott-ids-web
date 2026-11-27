'use client';

import { useEffect, useId, useRef, useState } from 'react';
import { doc, onSnapshot } from 'firebase/firestore';
import { firebaseClient } from '@/lib/firebase';
import type { AlertRecord } from '@/lib/alert-types';
import { actionDetails, alertDetailExport, classificationDetails, modelHex, protocolLabel, transportPort } from '@/lib/alert-details.mjs';
import styles from './alert-details.module.css';

export function AlertDetails({ orgId, deviceId, alertId, onClose }: {
  orgId: string; deviceId: string; alertId: string; onClose: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const descriptionId = useId();
  const [record, setRecord] = useState<AlertRecord | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [cached, setCached] = useState(true);
  const [error, setError] = useState('');
  const [copied, setCopied] = useState('');
  const copyVersion = useRef(0);

  useEffect(() => {
    const modal = dialog.current;
    if (!modal) return;
    if (!modal.open) modal.showModal();
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = previousOverflow; };
  }, []);

  useEffect(() => {
    let active = true;
    const unsubscribe = onSnapshot(doc(firebaseClient().db, 'organizations', orgId, 'devices', deviceId, 'alerts', alertId), { includeMetadataChanges: true }, snapshot => {
      if (!active) return;
      setRecord(snapshot.exists() ? { ...snapshot.data(), id: snapshot.id } as AlertRecord : null);
      setLoaded(true); setCached(snapshot.metadata.fromCache); setError(''); setCopied(''); copyVersion.current++;
    }, failure => {
      if (!active) return;
      setRecord(null); setLoaded(true); setCopied(''); copyVersion.current++;
      setError(failure.code === 'permission-denied' ? 'Bạn không còn quyền xem cảnh báo này.' : 'Không thể tải chi tiết. Đóng khung và thử lại sau khi kiểm tra kết nối.');
    });
    return () => { active = false; copyVersion.current++; unsubscribe(); };
  }, [orgId, deviceId, alertId]);

  async function copyRecord() {
    if (!record) return;
    const version = ++copyVersion.current;
    try {
      await navigator.clipboard.writeText(JSON.stringify(alertDetailExport(record, orgId, deviceId), null, 2));
      if (version === copyVersion.current) setCopied('Đã sao chép JSON cảnh báo.');
    } catch {
      if (version === copyVersion.current) setCopied('Không thể truy cập clipboard. Bạn có thể chọn và sao chép nội dung JSON bên dưới.');
    }
  }

  const classification = classificationDetails(record?.class_id);
  const action = actionDetails(record?.action);
  return <dialog ref={dialog} className={styles.dialog} aria-labelledby={titleId} aria-describedby={descriptionId} onClose={onClose}>
    <div className={styles.header}><div><p>ALERT INSPECTOR</p><h2 id={titleId}>Chi tiết cảnh báo</h2></div><button type="button" className={styles.close} onClick={() => dialog.current?.close()} aria-label="Đóng chi tiết cảnh báo" autoFocus>Đóng <span aria-hidden="true">×</span></button></div>
    <div className={styles.content}><p id={descriptionId} className={styles.context}>Thiết bị <strong>{deviceId}</strong><span>Nhóm {orgId}</span></p>
      {!loaded ? <p role="status" className={styles.state}>Đang tải chi tiết cảnh báo…</p> : error ? <p role="alert" className={styles.warning}>{error}</p> : !record ? <div className={styles.state} role="status"><h3>{cached ? 'Chưa tải được bản ghi từ server' : 'Cảnh báo không còn tồn tại'}</h3><p>{cached ? 'Đang chờ kết nối để kiểm tra cảnh báo này.' : 'Cảnh báo có thể đã được xóa. Đóng khung để quay lại danh sách.'}</p></div> : <>
        {cached ? <p className={styles.cacheNotice} role="status">Đang xem dữ liệu lưu đệm; chờ server để xác nhận bản ghi hiện tại.</p> : null}
        <section className={`${styles.verdict} ${classification.attack ? styles.attack : ''}`} aria-label="Phân loại và hành động"><div><span className={styles.verdictLabel}>PHÂN LOẠI TỪ FPGA</span><h3>{classification.label}</h3></div><span className={`${styles.actionBadge} ${action.tone === 'drop' ? styles.drop : ''}`}>{action.label}</span><p>{action.description}</p></section>
        {record.tree_error !== undefined && record.tree_error !== 0 ? <p className={styles.warning} role="status">FPGA báo mã lỗi cây <strong>{record.tree_error}</strong> trong sự kiện này. Cần kiểm tra thông tin model và log thiết bị trước khi đánh giá kết quả phân loại.</p> : null}
        <section className={styles.section} aria-labelledby={`${titleId}-network`}><h3 id={`${titleId}-network`}>Kết nối được ghi nhận</h3><div className={styles.endpoints}><div><span>NGUỒN</span><strong>{record.src_ip ?? '—'}</strong><p>Cổng <b>{transportPort(record.protocol, record.src_port)}</b></p></div><div className={styles.protocol}>{protocolLabel(record.protocol)}<span>Protocol {record.protocol ?? '—'}</span></div><div><span>ĐÍCH</span><strong>{record.dst_ip ?? '—'}</strong><p>Cổng <b>{transportPort(record.protocol, record.dst_port)}</b></p></div></div></section>
        <section className={styles.section} aria-labelledby={`${titleId}-event`}><h3 id={`${titleId}-event`}>Thời gian và định danh</h3><dl className={styles.fields}><div><dt>Server nhận lúc</dt><dd>{record.received_at?.toDate ? record.received_at.toDate().toLocaleString('vi-VN') : '—'}</dd></div><div><dt>Timestamp FPGA (ms)</dt><dd>{record.timestamp_ms ?? '—'}</dd></div><div><dt>Event ID</dt><dd className={styles.mono}>{record.event_id ?? '—'}</dd></div><div><dt>Cổng ingress (mã thô)</dt><dd>{record.ingress_port ?? '—'}</dd></div><div className={styles.wide}><dt>Phiên sự kiện · Boot ID</dt><dd className={styles.mono}>{record.boot_id ?? '—'}</dd></div><div className={styles.wide}><dt>Mã cảnh báo trên server</dt><dd className={styles.mono}>{alertId}</dd></div></dl><p className={styles.note}>Timestamp FPGA là bộ đếm thời gian của FPGA, không phải ngày giờ thực. Sự kiện gửi bù có thể được server nhận muộn; không dùng hai giá trị này để suy ra độ trễ mạng. Boot ID là phiên định danh sự kiện, không nhất thiết là một lần ESP khởi động.</p></section>
        <section className={styles.section} aria-labelledby={`${titleId}-model`}><h3 id={`${titleId}-model`}>Model và chẩn đoán FPGA</h3><dl className={styles.fields}><div><dt>Model version</dt><dd>{record.model_version ?? '—'} <span className={styles.hex}>{modelHex(record.model_version)}</span></dd></div><div><dt>Mã lỗi cây</dt><dd>{record.tree_error === 0 ? '0 · Không báo lỗi' : record.tree_error ?? '—'}</dd></div><div><dt>Số bước cây</dt><dd>{record.tree_steps ?? '—'}</dd></div><div><dt>Độ trễ xử lý (chu kỳ)</dt><dd>{record.latency_cycles ?? '—'}</dd></div></dl><p className={styles.note}>Độ trễ tính theo chu kỳ phần cứng được ghi trong sự kiện, không phải thời gian gửi HTTPS. Trang này chỉ đọc bản ghi; không gửi lệnh chặn hoặc thay đổi model.</p></section>
        <details className={styles.json}><summary>Dữ liệu kỹ thuật · JSON</summary><button type="button" onClick={copyRecord} className={styles.copy}>Sao chép JSON</button><p role="status">{copied}</p><pre tabIndex={0} aria-label="JSON cảnh báo">{JSON.stringify(alertDetailExport(record, orgId, deviceId), null, 2)}</pre></details>
      </>}
    </div>
    <div className={styles.footer}><span>Thông tin theo bản ghi thiết bị gửi</span><button type="button" onClick={() => dialog.current?.close()}>Quay lại danh sách</button></div>
  </dialog>;
}
