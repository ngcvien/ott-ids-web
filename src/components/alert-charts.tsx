'use client';

import { useEffect, useId, useMemo, useState, type CSSProperties } from 'react';
import type { AlertRecord } from '@/lib/alert-types';
import { summarizeAlerts } from '@/lib/alert-analytics.mjs';
import styles from './alert-charts.module.css';

const fullTime = (value: number) => new Date(value).toLocaleString('vi-VN');
const percent = (value: number) => value.toLocaleString('vi-VN', { maximumFractionDigits: 1 });

export function AlertCharts({ alerts, loaded, cached, error }: { alerts: AlertRecord[]; loaded: boolean; cached: boolean; error: string }) {
  const [range, setRange] = useState('sample');
  const [now, setNow] = useState(() => Date.now());
  const [active, setActive] = useState(11);
  const chartId = useId();
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 30000);
    const refresh = () => setNow(Date.now());
    document.addEventListener('visibilitychange', refresh);
    return () => { clearInterval(timer); document.removeEventListener('visibilitychange', refresh); };
  }, []);
  const data = useMemo(() => summarizeAlerts(alerts, range, now), [alerts, range, now]);
  const span = data.end - data.start;
  const timeLabel = (value: number) => new Date(value).toLocaleString('vi-VN', {
    day: span > 86400000 ? '2-digit' : undefined, month: span > 86400000 ? '2-digit' : undefined,
    hour: '2-digit', minute: '2-digit', second: span < 1800000 ? '2-digit' : undefined,
  });
  const maximum = Math.max(2, ...data.buckets.map(bucket => bucket.total));
  const x = (index: number) => 48 + index * 58;
  const y = (count: number) => 188 - count / maximum * 146;
  const totalPath = data.buckets.map((bucket, index) => `${index ? 'L' : 'M'}${x(index)},${y(bucket.total)}`).join(' ');
  const attackPath = data.buckets.map((bucket, index) => `${index ? 'L' : 'M'}${x(index)},${y(bucket.attacks)}`).join(' ');
  const point = data.buckets[active];
  const otherPercent = data.total ? data.otherClasses / data.total * 100 : 0;
  const ringStyle = { background: data.total ? `conic-gradient(#fa8396 0% ${data.attackPercent}%, #78cbb8 ${data.attackPercent}% ${data.attackPercent+otherPercent}%, #697b94 ${data.attackPercent+otherPercent}% 100%)` : '#2a3b50' } as CSSProperties;
  return <section className={styles.analytics} aria-labelledby={`${chartId}-heading`} aria-busy={!loaded}>
    <div className={styles.heading}><div><p>SECURITY ANALYTICS</p><h2 id={`${chartId}-heading`}>Góc nhìn cảnh báo</h2></div><label className={styles.range}>Khoảng thống kê<select value={range} onChange={event => { setRange(event.target.value); setActive(11); setNow(Date.now()); }}><option value="sample">Toàn bộ mẫu đã tải</option><option value="15m">15 phút gần nhất</option><option value="1h">1 giờ gần nhất</option><option value="24h">24 giờ gần nhất</option></select></label></div>
    <p className={styles.scope}>Thống kê tối đa 100 cảnh báo trong danh sách của thiết bị đang chọn. Bộ lọc tìm kiếm của bảng không áp dụng cho biểu đồ.</p>
    {error ? <p className={styles.state} role="status">Biểu đồ tạm ngừng vì không tải được cảnh báo.</p> : !loaded ? <p className={styles.state} role="status">Đang tổng hợp dữ liệu cảnh báo…</p> : <>
      <div className={styles.scopeBadges}><span>{data.total} / {alerts.length} bản ghi trong khoảng</span>{cached ? <span className={styles.caution}>Dữ liệu lưu đệm · chờ đồng bộ</span> : null}{alerts.length >= 100 ? <span className={styles.caution}>Đã đạt giới hạn mẫu 100 bản ghi</span> : null}{data.ignored ? <span className={styles.caution}>{data.ignored} bản ghi thiếu thời gian nhận</span> : null}</div>
      <div className={styles.grid}>
        <article className={`${styles.card} ${styles.timeline}`}><div className={styles.cardHeader}><div><h3>Diễn biến cảnh báo</h3><p>12 khoảng thời gian · {range === 'sample' ? 'trong mẫu đã tải' : 'theo khoảng đã chọn'}</p></div><div className={styles.legend}><span><i/>Tổng cảnh báo</span><span><i className={styles.attackDot}/>Tấn công · Class 1</span></div></div>
          {!data.total ? <div className={styles.empty}><span>Chưa có dữ liệu trong khoảng này</span><p>Thử chọn “Toàn bộ mẫu đã tải” hoặc chờ cảnh báo mới.</p></div> : <>
            <div className={styles.plot}>
              <svg viewBox="0 0 720 234" role="img" aria-labelledby={`${chartId}-title ${chartId}-desc`} onPointerMove={event => {
                const rect = event.currentTarget.getBoundingClientRect();
                setActive(Math.max(0, Math.min(11, Math.round(((event.clientX - rect.left) / rect.width * 720 - 48) / 58))));
              }}><title id={`${chartId}-title`}>Tổng cảnh báo và tấn công Class 1 theo thời gian</title><desc id={`${chartId}-desc`}>{data.total} cảnh báo, trong đó {data.attacks} Class 1. Dùng thanh chọn mốc bên dưới để đọc từng khoảng.</desc>
                <defs><linearGradient id={`${chartId}-fill`} x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="#78cbb8" stopOpacity=".23"/><stop offset="100%" stopColor="#78cbb8" stopOpacity="0"/></linearGradient></defs>
                {[0, Math.ceil(maximum/2), maximum].map(tick => <g key={tick}><line x1="42" x2="698" y1={y(tick)} y2={y(tick)} stroke="#2b3d52" strokeDasharray="3 6"/><text x="31" y={y(tick)+4} textAnchor="end" fill="#92a8bf" fontSize="12">{tick}</text></g>)}
                <path d={`${totalPath} L${x(11)},188 L${x(0)},188 Z`} fill={`url(#${chartId}-fill)`}/><path d={totalPath} fill="none" stroke="#78cbb8" strokeWidth="2.5" strokeLinejoin="round"/><path d={attackPath} fill="none" stroke="#fa8396" strokeWidth="2.5" strokeLinejoin="round"/>
                <line x1={x(active)} x2={x(active)} y1="32" y2="188" stroke="#b4c9dd" strokeOpacity=".45" strokeDasharray="4 4"/><circle cx={x(active)} cy={y(point.total)} r="4.5" fill="#78cbb8" stroke="#122031" strokeWidth="2"/><circle cx={x(active)} cy={y(point.attacks)} r="4.5" fill="#fa8396" stroke="#122031" strokeWidth="2"/>
                {[0,5,11].map(index => <text key={index} x={x(index)} y="218" textAnchor={index===0 ? 'start' : index===11 ? 'end' : 'middle'} fill="#9cb3ca" fontSize="12">{timeLabel(data.buckets[index].start)}</text>)}
              </svg>
            </div>
            <div className={styles.mobileAxis} aria-hidden="true"><span>{timeLabel(data.buckets[0].start)}</span><span>{timeLabel(data.buckets[5].start)}</span><span>{timeLabel(data.buckets[11].start)}</span></div>
            <p className={styles.mobileScale}>Trục tung: 0–{maximum} cảnh báo</p>
            <label className={styles.scrubber}><span>Chọn mốc thời gian</span><input type="range" min="0" max="11" step="1" value={active} onChange={event => setActive(Number(event.target.value))} aria-valuetext={`${fullTime(point.start)} đến ${fullTime(point.end)}: ${point.total} cảnh báo, ${point.attacks} tấn công`}/></label>
            <div className={styles.pointDetail}><span>{timeLabel(point.start)} – {timeLabel(point.end)}</span><span><b>{point.total}</b> cảnh báo</span><span className={styles.attackText}><b>{point.attacks}</b> Class 1</span><span><b>{point.drops}</b> Drop</span></div>
            <p className={styles.timeExtent}>{fullTime(data.start)} – {fullTime(data.end)}</p>
            <details className={styles.dataTable}><summary>Xem số liệu từng khoảng</summary><div><table><caption className="sr-only">Số liệu biểu đồ cảnh báo</caption><thead><tr><th>Khoảng thời gian</th><th>Tổng</th><th>Class 1</th><th>Drop</th></tr></thead><tbody>{data.buckets.map((bucket,index) => <tr key={index}><td>{fullTime(bucket.start)} – {timeLabel(bucket.end)}</td><td>{bucket.total}</td><td>{bucket.attacks}</td><td>{bucket.drops}</td></tr>)}</tbody></table></div></details>
          </>}
        </article>
        <article className={styles.card}><div className={styles.cardHeader}><div><h3>Tỷ lệ phân loại</h3><p>Trên {data.total} cảnh báo trong khoảng</p></div></div><div className={styles.distribution}><div className={styles.ring} style={ringStyle} role="img" aria-label={data.total ? `${percent(data.attackPercent)} phần trăm cảnh báo là Class 1` : 'Chưa có dữ liệu phân loại'}><div><strong>{data.total ? `${percent(data.attackPercent)}%` : '—'}</strong><span>Tấn công · Class 1</span></div></div><ul className={styles.classLegend}><li><i className={styles.attackDot}/><span>Tấn công · Class 1</span><b>{data.attacks}</b></li><li><i/><span>Class khác</span><b>{data.otherClasses}</b></li>{data.unknownClasses ? <li><i className={styles.unknownDot}/><span>Chưa phân loại</span><b>{data.unknownClasses}</b></li> : null}</ul></div><p className={styles.cardNote}>Đây là tỷ lệ trong cảnh báo đã tải, không phải tỷ lệ tấn công của toàn bộ lưu lượng mạng.</p></article>
        <article className={styles.card}><div className={styles.cardHeader}><div><h3>Phân bố giao thức</h3><p>Số cảnh báo theo IP protocol</p></div></div>{!data.total ? <div className={styles.protocolEmpty}>Chưa có dữ liệu giao thức.</div> : <ul className={styles.protocols}>{data.protocols.map(protocol => <li key={protocol.key}><div><span>{protocol.label}</span><span><b>{protocol.count}</b> <small>{percent(protocol.count/data.total*100)}%</small></span></div><div className={styles.track}><div style={{ width: `${protocol.count/data.total*100}%` }}/></div></li>)}</ul>}<p className={styles.cardNote}>Số cảnh báo theo giao thức, không đại diện băng thông hoặc số packet toàn mạng.</p></article>
      </div>
      <p className={styles.footnote}>Mốc trống nghĩa là không có bản ghi trong mẫu này. Khi chạm giới hạn 100, dữ liệu cũ hơn có thể không nằm trong thống kê. Phân loại tấn công và hành động Drop là hai thông tin riêng.</p>
    </>}
  </section>;
}
