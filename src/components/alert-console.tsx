'use client';

import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { onAuthStateChanged, signInWithEmailAndPassword, signOut, type User } from 'firebase/auth';
import { collection, doc, limit, onSnapshot, orderBy, query } from 'firebase/firestore';
import Link from 'next/link';
import { AlertDetails } from '@/components/alert-details';
import { AlertCharts } from '@/components/alert-charts';
import type { AlertRecord } from '@/lib/alert-types';
import { DeviceFleet, type DeviceSummary } from '@/components/device-fleet';
import { ModelManager } from '@/components/model-manager';
import { firebaseClient } from '@/lib/firebase';
import { createAttackDetector } from '@/lib/attack-detector.mjs';

type Choice = { id: string; name: string };
type Alert = AlertRecord;

type IconName = 'shield' | 'activity' | 'devices' | 'grid' | 'logout' | 'lock' | 'search' | 'eye' | 'eye-off' | 'check' | 'flow';
function Icon({ name, className = '' }: { name: IconName; className?: string }) {
  const paths: Record<IconName, React.ReactNode> = {
    shield: <><path d="m12 3 8 3v6c0 5-8 9-8 9S4 17 4 12V6l8-3Z"/><path d="m8.5 12 2.5 2.5 4.5-5"/></>,
    activity: <><path d="M3 12h4l3-8 4 16 3-8h4"/></>,
    devices: <><rect x="3" y="3" width="18" height="7" rx="2"/><rect x="3" y="14" width="18" height="7" rx="2"/><path d="M7 6.5h.01M7 17.5h.01M11 6.5h6M11 17.5h6"/></>,
    grid: <><rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/><rect x="14" y="14" width="7" height="7" rx="1.5"/></>,
    logout: <><path d="M9 4H4v16h5M9 12h12m-4-4 4 4-4 4"/></>,
    lock: <><rect x="5" y="10" width="14" height="11" rx="2"/><path d="M8 10V7a4 4 0 0 1 8 0v3M12 14v3"/></>,
    search: <><circle cx="10.5" cy="10.5" r="6.5"/><path d="m16 16 5 5"/></>,
    eye: <><path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12Z"/><circle cx="12" cy="12" r="3"/></>,
    'eye-off': <><path d="m3 3 18 18M9.5 5.3A12 12 0 0 1 12 5c6.5 0 10 7 10 7a18 18 0 0 1-3 3.8M6 6.5A22 22 0 0 0 2 12s3.5 7 10 7a12 12 0 0 0 5-1.2"/></>,
    check: <path d="m5 12 4 4L19 6"/>,
    flow: <><circle cx="5" cy="5" r="2"/><circle cx="19" cy="19" r="2"/><path d="M5 7v7a5 5 0 0 0 5 5h7M8 5h7a4 4 0 0 1 4 4v7"/></>,
  };
  return <svg className={`icon ${className}`} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.65" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{paths[name]}</svg>;
}
function Brand() {
  return <a href="/" className="brand" aria-label="OTT-IDS — trang chủ"><span className="brand-mark"><Icon name="shield"/></span><span>OTT<span className="brand-accent">-IDS</span><small>NETWORK SECURITY PLATFORM</small></span></a>;
}
function NetworkIllustration() {
  return <div className="network-visual" aria-hidden="true"><div className="network-grid"/><svg viewBox="0 0 560 190" className="network-lines"><path d="M94 95H280M280 95H466"/><path className="signal-path" d="M94 95H280M280 95H466"/><circle cx="185" cy="95" r="4"/><circle cx="375" cy="95" r="4"/></svg><div className="network-nodes"><div className="network-node"><span><Icon name="devices"/></span><strong>Thiết bị</strong><small>Lõi IDS · ESP32</small></div><div className="network-node central"><span><Icon name="shield"/></span><strong>OTT-IDS</strong><small>Tiếp nhận & xác thực</small></div><div className="network-node"><span><Icon name="activity"/></span><strong>Giám sát</strong><small>Cảnh báo thời gian thực</small></div></div></div>;
}

function dataError(code?: string) {
  return code === 'permission-denied'
    ? 'Không có quyền đọc dữ liệu. Kiểm tra Firestore Rules và quyền thành viên của tài khoản.'
    : 'Không thể tải dữ liệu. Kiểm tra kết nối và cấu hình Firestore.';
}

export function AlertConsole({ view = 'alerts' }: { view?: 'alerts' | 'devices' }) {
  const [user, setUser] = useState<User | null>(null);
  const [ready, setReady] = useState(false);
  const [setupError, setSetupError] = useState('');
  const [authError, setAuthError] = useState('');
  const [busy, setBusy] = useState(false);
  const [showPassword, setShowPassword] = useState(false);

  useEffect(() => {
    try {
      return onAuthStateChanged(firebaseClient().auth, current => {
        setUser(current); setReady(true);
      }, () => { setSetupError('Không thể kiểm tra phiên đăng nhập.'); setReady(true); });
    } catch (error) {
      setSetupError(error instanceof Error ? error.message : 'Không thể khởi tạo Firebase.');
      setReady(true);
    }
  }, []);

  async function login(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setBusy(true); setAuthError('');
    const fields = new FormData(event.currentTarget);
    try {
      await signInWithEmailAndPassword(firebaseClient().auth, String(fields.get('email')).trim(), String(fields.get('password')));
    } catch {
      setAuthError('Đăng nhập thất bại. Kiểm tra email, mật khẩu, kết nối hoặc Email/Password đã được bật trong Firebase.');
    } finally { setBusy(false); }
  }

  async function logout() {
    setAuthError('');
    try { await signOut(firebaseClient().auth); }
    catch { setAuthError('Chưa đăng xuất được. Vui lòng thử lại.'); }
  }

  return <div className={`shell ${user && !setupError ? 'signed-in' : 'signed-out'}`}>
    {user && !setupError ? <aside className="sidebar"><Brand/><div className="nav-section-label">KHÔNG GIAN LÀM VIỆC</div><nav aria-label="Điều hướng chính"><Link href="/dashboard" className={`nav-link ${view === 'alerts' ? 'active' : ''}`} aria-current={view === 'alerts' ? 'page' : undefined}><Icon name="activity"/>Cảnh báo</Link><Link href="/dashboard/devices" className={`nav-link ${view === 'devices' ? 'active' : ''}`} aria-current={view === 'devices' ? 'page' : undefined}><Icon name="devices"/>Thiết bị</Link></nav><div className="sidebar-note"><Icon name="shield"/><strong>Giám sát tập trung</strong><p>Một không gian dành cho các thiết bị và cảnh báo của bạn.</p></div><div className="sidebar-account"><span className="avatar">{(user.email || 'OT').slice(0, 2).toUpperCase()}</span><div><strong>Tài khoản giám sát</strong><span title={user.email || ''}>{user.email}</span></div></div></aside> : null}
    <header className="topbar">
      {user && !setupError ? <div className="breadcrumb">Không gian làm việc<span>/</span><strong>{view === 'devices' ? 'Thiết bị' : 'Cảnh báo an ninh'}</strong></div> : <Brand/>}
      <span className="header-label"><Icon name="lock"/>{user ? 'Quyền truy cập được kiểm soát' : 'TRUNG TÂM GIÁM SÁT AN NINH'}</span>
      {user ? <button className="secondary logout-button" onClick={logout}><Icon name="logout"/><span>Đăng xuất</span></button> : <span className="header-version">OTT-IDS Console</span>}
    </header>
    {!ready ? <main className="login"><p role="status">Đang kiểm tra phiên đăng nhập…</p></main> : setupError ?
      <main className="login"><div className="card"><p className="eyebrow">CẤU HÌNH KẾT NỐI</p><h1>Chưa thể kết nối</h1><p role="alert" className="error">{setupError}</p></div></main> : user ?
      <><Workspace key={user.uid} user={user} view={view} />{authError ? <p className="error notice" role="alert">{authError}</p> : null}</> :
      <main className="login">
        <section className="intro"><div className="platform-label"><span/>NỀN TẢNG GIÁM SÁT OTT-IDS</div><h1>Hiểu rõ mạng của bạn.<br/><span>Chủ động trước<br className="desktop-break"/> mọi cảnh báo.</span></h1><p className="intro-description">Kết nối thiết bị, theo dõi sự kiện và nắm bắt những dấu hiệu bất thường — trong một không gian giám sát thống nhất.</p><NetworkIllustration/><div className="intro-features"><span><Icon name="check"/>Cảnh báo realtime</span><span><Icon name="check"/>Phân quyền thiết bị</span><span><Icon name="check"/>Lịch sử tập trung</span></div></section>
        <div className="login-form-column">
        <form className="card" onSubmit={login}>
          <div className="form-emblem"><Icon name="shield"/></div><p className="eyebrow">CHÀO MỪNG TRỞ LẠI</p><h2>Đăng nhập hệ thống</h2><p className="form-description">Truy cập không gian giám sát của bạn.</p>
          <label htmlFor="email">Địa chỉ email</label><input id="email" name="email" type="email" autoComplete="username" placeholder="ban@congty.vn" required />
          <label htmlFor="password">Mật khẩu</label><div className="password-field"><input id="password" name="password" type={showPassword ? 'text' : 'password'} autoComplete="current-password" placeholder="Nhập mật khẩu của bạn" required /><button type="button" className="password-toggle" aria-label={showPassword ? 'Ẩn mật khẩu' : 'Hiện mật khẩu'} aria-pressed={showPassword} onClick={() => setShowPassword(value => !value)}><Icon name={showPassword ? 'eye-off' : 'eye'}/></button></div>
          {authError ? <p className="error" role="alert">{authError}</p> : null}
          <button disabled={busy} type="submit" className="login-submit">{busy ? 'Đang đăng nhập…' : 'Đăng nhập'}<Icon name="lock"/></button>
          <div className="form-divider"/><p className="footnote"><Icon name="lock"/>Chỉ dành cho tài khoản được cấp quyền.<br/>Liên hệ quản trị viên nếu bạn cần hỗ trợ truy cập.</p>
        </form>
        <p className="form-caption">OTT-IDS <span>·</span> Network security, in focus.</p></div>
      </main>}
    {!user ? <footer className="login-footer"><span>OTT-IDS · Nền tảng giám sát an ninh mạng</span><span>Thiết bị của bạn. Dữ liệu của bạn.</span></footer> : null}
  </div>;
}

function Workspace({ user, view }: { user: User; view: 'alerts' | 'devices' }) {
  const [groups, setGroups] = useState<Choice[]>([]);
  const [selected, setSelected] = useState('');
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => onSnapshot(collection(firebaseClient().db, 'users', user.uid, 'memberships'), snapshot => {
    setGroups(snapshot.docs.map(doc => ({ id: doc.id, name: String(doc.data().name || doc.id).replace(/lastdance/gi, 'OTT-IDS') })));
    setLoaded(true); setError('');
  }, error => { setGroups([]); setError(dataError(error.code)); setLoaded(true); }), [user.uid]);
  useEffect(() => { setSelected(new URLSearchParams(window.location.search).get('org') || ''); }, []);
  const orgId = groups.some(group => group.id === selected) ? selected : groups[0]?.id || '';
  return <main className="workspace" id="overview">
    <div className="page-heading"><div><p className="eyebrow">SECURITY OPERATIONS</p><h1>{view === 'devices' ? 'Quản lý thiết bị' : 'Trung tâm cảnh báo'}<span className="heading-dot">.</span></h1><p className="muted">{view === 'devices' ? 'Theo dõi kết nối và tình trạng gửi dữ liệu của ESP32.' : 'Theo dõi và phân tích các sự kiện an ninh từ thiết bị của bạn.'}</p></div><label className="picker">Không gian giám sát<select value={orgId} onChange={event => setSelected(event.target.value)} disabled={!groups.length}>{groups.length ? groups.map(group => <option key={group.id} value={group.id}>{group.name}</option>) : <option value="">Chưa có nhóm</option>}</select></label></div>
    {error ? <p role="alert" className="error notice">{error}</p> : !loaded ? <p role="status">Đang tải quyền truy cập…</p> : !orgId ?
      <div className="empty standalone"><Icon name="devices"/><h2>Chưa có thiết bị được cấp quyền</h2><p>Nhờ quản trị viên thêm tài khoản của bạn vào nhóm thiết bị.</p></div> : <DeviceWorkspace key={orgId} orgId={orgId} user={user} view={view} />}
  </main>;
}

function DeviceWorkspace({ orgId, user, view }: { orgId: string; user: User; view: 'alerts' | 'devices' }) {
  const [devices, setDevices] = useState<DeviceSummary[]>([]);
  const [cached, setCached] = useState(true);
  const [selected, setSelected] = useState('');
  useEffect(() => { setSelected(new URLSearchParams(window.location.search).get('device') || ''); }, []);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => onSnapshot(collection(firebaseClient().db, 'organizations', orgId, 'devices'), { includeMetadataChanges: true }, snapshot => {
    setDevices(snapshot.docs.map(doc => ({ ...doc.data(), id: doc.id, name: String(doc.data().name || doc.id) } as DeviceSummary)));
    setCached(snapshot.metadata.fromCache);
    setLoaded(true); setError('');
  }, error => { setDevices([]); setError(dataError(error.code)); setLoaded(true); }), [orgId]);
  if (view === 'devices') return error ? <p role="alert" className="error notice">{error}</p> : !loaded ? <p role="status">Đang tải thiết bị…</p> : <><ModelManager orgId={orgId} user={user} devices={devices} cached={cached}/><DeviceFleet orgId={orgId} devices={devices} cached={cached} /></>;
  const deviceId = devices.some(device => device.id === selected) ? selected : devices[0]?.id || '';
  return <>
    <div className="toolbar"><div className="toolbar-title"><span className="toolbar-icon"><Icon name="devices"/></span><div><strong>Nguồn cảnh báo</strong><span>{devices.length} thiết bị được cấp quyền trong nhóm</span></div></div><label className="picker device-picker"><span className="sr-only">Thiết bị</span><select value={deviceId} onChange={event => setSelected(event.target.value)} disabled={!devices.length}>{devices.length ? devices.map(device => <option key={device.id} value={device.id}>{device.name} · {device.id}</option>) : <option value="">Chưa có thiết bị</option>}</select></label></div>
    {error ? <p role="alert" className="error notice">{error}</p> : !loaded ? <p role="status">Đang tải thiết bị…</p> : deviceId ? <Alerts key={deviceId} orgId={orgId} deviceId={deviceId} user={user} /> : <div className="empty"><h2>Nhóm chưa có thiết bị</h2><p>Thiết bị sẽ xuất hiện sau khi quản trị viên đăng ký.</p></div>}
  </>;
}

function Alerts({ orgId, deviceId, user }: { orgId: string; deviceId: string; user: User }) {
  const [alerts, setAlerts] = useState<Alert[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState('');
  const [cached, setCached] = useState(false);
  const [search, setSearch] = useState('');
  const [actionFilter, setActionFilter] = useState('all');
  const [canClear, setCanClear] = useState(false);
  const [clearing, setClearing] = useState(false);
  const [clearMessage, setClearMessage] = useState('');
  const [clearError, setClearError] = useState('');
  const [flash, setFlash] = useState(false);
  const [attackMessage, setAttackMessage] = useState('');
  const [selectedAlertId, setSelectedAlertId] = useState('');
  const closeDetails = useCallback(() => setSelectedAlertId(''), []);
  useEffect(() => onSnapshot(doc(firebaseClient().db, 'organizations', orgId, 'members', user.uid), snapshot => {
    setCanClear(snapshot.data()?.role === 'owner');
  }, () => setCanClear(false)), [orgId, user.uid]);
  useEffect(() => {
    const detectAttacks = createAttackDetector();
    let lastFlashAt = 0;
    let flashTimer: ReturnType<typeof setTimeout> | undefined;
    const unsubscribe = onSnapshot(query(collection(firebaseClient().db, 'organizations', orgId, 'devices', deviceId, 'alerts'), orderBy('received_at', 'desc'), limit(100)), { includeMetadataChanges: true }, snapshot => {
      const incoming = snapshot.docs.map(doc => ({ ...doc.data(), id: doc.id } as Alert));
      if (detectAttacks(incoming, snapshot.metadata.fromCache) > 0 && Date.now() - lastFlashAt >= 8000) {
        lastFlashAt = Date.now(); setFlash(true);
        setAttackMessage(`Vừa nhận cảnh báo tấn công Class 1 từ ${deviceId}.`);
        flashTimer = setTimeout(() => setFlash(false), 1800);
      }
      setAlerts(incoming); setLoaded(true); setCached(snapshot.metadata.fromCache); setError('');
    }, error => { setAlerts([]); setError(dataError(error.code)); setLoaded(true); });
    return () => { unsubscribe(); clearTimeout(flashTimer); };
  }, [orgId, deviceId]);
  const attacks = alerts.filter(alert => alert.class_id === 1).length;
  const term = search.trim().toLowerCase();
  const visibleAlerts = alerts.filter(alert => (actionFilter === 'all' || alert.action === actionFilter) &&
    (!term || [alert.src_ip, alert.dst_ip, alert.src_port, alert.dst_port, alert.class_id, alert.event_id, alert.class_id === 1 ? 'tấn công' : '', alert.protocol === 6 ? 'tcp' : alert.protocol === 17 ? 'udp' : alert.protocol].some(value => String(value ?? '').toLowerCase().includes(term))));
  async function clearVisibleAlerts() {
    const ids = visibleAlerts.map(alert => alert.id);
    if (!canClear || clearing || !ids.length) return;
    if (!window.confirm(`Xóa vĩnh viễn ${ids.length} cảnh báo đang hiển thị của ${deviceId}?\n\nCảnh báo mới và dữ liệu ngoài danh sách này được giữ lại. Không thay đổi lõi xử lý hoặc chế độ chặn.`)) return;
    setClearing(true); setClearError(''); setClearMessage('');
    try {
      const token = await user.getIdToken();
      const response = await fetch('/api/alerts', { method: 'DELETE', headers: {
        Authorization: `Bearer ${token}`, 'Content-Type': 'application/json',
      }, body: JSON.stringify({ orgId, deviceId, ids }) });
      const result = await response.json();
      if (!response.ok) throw new Error(response.status === 403 ? 'Chỉ owner của nhóm được xóa cảnh báo.' : response.status === 401 ? 'Phiên đăng nhập hết hạn. Vui lòng đăng nhập lại.' : 'Không xóa được cảnh báo. Vui lòng thử lại.');
      setClearMessage(`Đã xóa ${result.cleared} cảnh báo. Lịch sử cũ hơn có thể được tải bù vào danh sách.`);
    } catch (error) {
      setClearError(error instanceof Error ? error.message : 'Không xóa được cảnh báo.');
    } finally { setClearing(false); }
  }
  return <>
    {selectedAlertId ? <AlertDetails key={selectedAlertId} orgId={orgId} deviceId={deviceId} alertId={selectedAlertId} onClose={closeDetails} /> : null}
    {flash ? <div className="attack-screen-flash" aria-hidden="true"/> : null}
    {attackMessage ? <p className="new-attack-message" role="status">{attackMessage}</p> : null}
    <section className="stats" aria-label="Thống kê 100 cảnh báo mới nhất"><article><div className="stat-heading"><span>Cảnh báo đã tải</span><Icon name="activity"/></div><strong>{loaded && !error ? alerts.length.toLocaleString('vi-VN') : '—'}</strong><small>Trong 100 sự kiện gần nhất</small></article><article><div className="stat-heading"><span>Tấn công · Class 1</span><Icon name="shield"/></div><strong className="danger">{loaded && !error ? attacks.toLocaleString('vi-VN') : '—'}</strong><small>Phân loại tấn công từ thiết bị</small></article><article><div className="stat-heading"><span>Chế độ monitor</span><Icon name="eye"/></div><strong>{loaded && !error ? alerts.filter(alert => alert.action === 'monitor').length.toLocaleString('vi-VN') : '—'}</strong><small>Ghi nhận và theo dõi sự kiện</small></article><article className="connection-card"><div className="stat-heading"><span>Đồng bộ dữ liệu</span><Icon name="flow"/></div><strong className={`connection ${error ? 'danger' : ''}`}>{error ? 'Có lỗi kết nối' : !loaded ? 'Đang kết nối' : cached ? 'Chờ đồng bộ' : 'Đang cập nhật'}</strong><small>Trạng thái kết nối dashboard</small></article></section>
    <AlertCharts alerts={alerts} loaded={loaded} cached={cached} error={error}/>
    <section className="alerts-panel" id="alerts"><div className="panel-heading"><div><p className="eyebrow">EVENT STREAM</p><h2>Nhật ký cảnh báo</h2></div><span className="device-chip"><Icon name="devices"/>{deviceId}</span></div><div className="table-tools"><label className="search-field"><Icon name="search"/><span className="sr-only">Tìm trong 100 cảnh báo đã tải</span><input type="search" value={search} onChange={event => setSearch(event.target.value)} placeholder="Tìm IP, cổng, loại cảnh báo…"/></label><label className="action-picker"><span className="sr-only">Lọc hành động</span><select value={actionFilter} onChange={event => setActionFilter(event.target.value)}><option value="all">Tất cả hành động</option><option value="monitor">Monitor</option><option value="drop">Drop</option></select></label>{canClear ? <button type="button" className="clear-alerts-button" disabled={clearing || cached || !loaded || !visibleAlerts.length} onClick={clearVisibleAlerts}>{clearing ? 'Đang xóa…' : `Xóa cảnh báo (${visibleAlerts.length})`}</button> : null}</div>
      {clearMessage ? <p className="clear-feedback" role="status">{clearMessage}</p> : null}
      {clearError ? <p className="clear-feedback error" role="alert">{clearError}</p> : null}
      {error ? <p role="alert" className="error notice">{error}</p> : !loaded ? <p className="empty" role="status">Đang tải cảnh báo…</p> : !alerts.length ? <div className="empty"><span className="empty-icon"><Icon name="shield"/></span><h3>Chưa ghi nhận cảnh báo</h3><p>Các sự kiện mới từ thiết bị sẽ tự động hiển thị tại đây.</p><small>Đang theo dõi nguồn {deviceId}</small></div> : !visibleAlerts.length ? <div className="empty"><Icon name="search"/><h3>Không tìm thấy sự kiện phù hợp</h3><p>Thử thay đổi từ khóa hoặc bộ lọc hành động.</p><button className="secondary" onClick={() => { setSearch(''); setActionFilter('all'); }}>Xóa bộ lọc</button></div> : <div className="table-scroll"><table><thead><tr><th>Thời gian nhận</th><th>Phân loại</th><th>Địa chỉ nguồn</th><th>Địa chỉ đích</th><th>Giao thức</th><th>Hành động</th></tr></thead><tbody>{visibleAlerts.map(alert => <tr key={alert.id} className={`alert-interactive-row ${alert.class_id === 1 ? 'attack-row' : ''}`} tabIndex={0} aria-haspopup="dialog" onKeyDown={event => {
        if (event.target === event.currentTarget && (event.key === 'Enter' || event.key === ' ')) {
          event.preventDefault(); setSelectedAlertId(alert.id);
        }
      }} onClick={event => {
        if ((event.target as HTMLElement).closest('button, a') || window.getSelection()?.toString()) return;
        event.currentTarget.focus();
        setSelectedAlertId(alert.id);
      }}><td className="time-cell">{alert.received_at?.toDate ? <><strong>{alert.received_at.toDate().toLocaleTimeString('vi-VN')}</strong><span>{alert.received_at.toDate().toLocaleDateString('vi-VN')}</span></> : '—'}</td><td><span className={alert.class_id === 1 ? 'class-tag attack-tag' : 'class-tag'}>{alert.class_id === 1 ? 'Tấn công · Class 1' : `Class ${alert.class_id ?? '—'}`}</span></td><td className="mono">{alert.src_ip ?? '—'}<span className="port">:{alert.src_port ?? 0}</span></td><td className="mono">{alert.dst_ip ?? '—'}<span className="port">:{alert.dst_port ?? 0}</span></td><td><span className="protocol-tag">{alert.protocol === 6 ? 'TCP' : alert.protocol === 17 ? 'UDP' : alert.protocol ?? '—'}</span></td><td><span className={alert.action === 'drop' ? 'badge drop' : 'badge'}><span/>{alert.action ?? '—'}</span></td></tr>)}</tbody></table></div>}
      <div className="table-footer"><span role="status">Hiển thị {visibleAlerts.length} / {alerts.length} cảnh báo đã tải</span><span>Bấm một dòng để xem chi tiết · 100 sự kiện mới nhất</span></div>
    </section>
  </>;
}
