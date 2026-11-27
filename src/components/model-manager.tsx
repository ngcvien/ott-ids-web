'use client';

import { useEffect, useRef, useState, type FormEvent } from 'react';
import type { User } from 'firebase/auth';
import { collection, doc, limit, onSnapshot, orderBy, query, type Timestamp } from 'firebase/firestore';
import { firebaseClient } from '@/lib/firebase';
import type { DeviceSummary } from './device-fleet';

type ModelEntry = { id: string; name: string; model: { abi: number; version: number; node_count: number; crc32: string; sha256: string }; artifact?: { artifact_size: number; artifact_sha256: string } };
type CommandEntry = { command_id: string; name: string; version: number; status: string; error?: string; updated_at?: Timestamp };
const labels: Record<string,string> = { queued: 'Chờ ESP nhận lệnh', downloading: 'Đang tải / kiểm tra', loading: 'Đang nạp / chờ xác nhận', succeeded: 'Nạp thành công', failed: 'Nạp thất bại', cancelled: 'Đã hủy' };
const errorLabels: Record<string,string> = {
  owner_required: 'Chỉ owner được tải model và phát lệnh.', version_conflict: 'Version này đã có model khác. Hãy dùng version mới.',
  device_busy: 'Thiết bị đang có một lệnh chưa hoàn tất.', cannot_cancel: 'Lệnh đã được phép nạp hoặc đã kết thúc, không thể hủy.',
  invalid_gwm: 'File GWM không đúng định dạng Gateway24 v1, ABI 1 hoặc checksum không khớp.',
  invalid_model: 'Model không đúng định dạng ABI 1 hoặc checksum không khớp.', unauthorized: 'Phiên đăng nhập hết hạn. Hãy đăng nhập lại.',
  storage_failed: 'ESP không lưu được model vào flash.', fpga_not_ready: 'Lõi xử lý chưa sẵn sàng nhận model.',
  fpga_load_failed: 'Lõi xử lý không xác nhận model hợp lệ.', commit_failed: 'Đã nạp nhưng không lưu được trạng thái kích hoạt trên ESP.',
  interrupted: 'Lệnh bị gián đoạn hoặc không còn hiệu lực.',
};

async function modelRequest(user: User, url: string, body: object) {
  const token = await user.getIdToken();
  const response = await fetch(url, { method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const result = await response.json();
  if (!response.ok) {
    const error = new Error(errorLabels[result.code] || 'Không thực hiện được thao tác. Kiểm tra kết nối và thử lại.');
    Object.assign(error, { status: response.status }); throw error;
  }
  return result;
}

function CommandHistory({ orgId, deviceId }: { orgId: string; deviceId: string }) {
  const [jobs, setJobs] = useState<CommandEntry[]>([]);
  const [error, setError] = useState('');
  const [loaded, setLoaded] = useState(false);
  useEffect(() => onSnapshot(query(collection(firebaseClient().db, 'organizations', orgId, 'devices', deviceId, 'modelCommands'), orderBy('requested_at', 'desc'), limit(20)), snapshot => {
    setJobs(snapshot.docs.map(doc => doc.data() as CommandEntry)); setLoaded(true); setError('');
  }, () => { setJobs([]); setLoaded(true); setError('Chưa đọc được lịch sử lệnh. Kiểm tra Firestore Rules và kết nối.'); }), [orgId, deviceId]);
  return <div className="model-history"><h3>Lịch sử nạp · {deviceId}</h3>{error ? <p className="error" role="alert">{error}</p> : !loaded ? <p role="status">Đang tải lịch sử…</p> : !jobs.length ? <p>Chưa có lệnh nạp model.</p> : <ul>{jobs.map(job => <li key={job.command_id}><div><strong>{job.name}</strong><span>Version {job.version} · {job.updated_at?.toDate?.().toLocaleString('vi-VN') || 'Đang cập nhật'}</span><code>{job.command_id}</code></div><div><span className={`model-status status-${job.status}`}>{labels[job.status] || job.status}</span>{job.error ? <p>{errorLabels[job.error] || job.error}</p> : null}</div></li>)}</ul>}</div>;
}

export function ModelManager({ orgId, user, devices, cached }: { orgId: string; user: User; devices: DeviceSummary[]; cached: boolean }) {
  const [models, setModels] = useState<ModelEntry[]>([]);
  const [owner, setOwner] = useState(false);
  const [name, setName] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [fileVersion, setFileVersion] = useState<number | null>(null);
  const [selectedModel, setSelectedModel] = useState('');
  const [selectedDevice, setSelectedDevice] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const requestIdentity = useRef<{ device: string; model: string; id: string } | null>(null);
  useEffect(() => {
    let cancelled = false;
    setFileVersion(null);
    if (file && file.size >= 80 && file.size <= 1096) {
      file.slice(0,80).arrayBuffer().then(header => {
        if (!cancelled && new TextDecoder().decode(header.slice(0,8)) === 'GW24MODL') setFileVersion(new DataView(header).getUint32(16,false));
      }).catch(() => { if (!cancelled) setError('Không đọc được file đã chọn. Hãy chọn lại.'); });
    }
    return () => { cancelled = true; };
  }, [file]);
  useEffect(() => onSnapshot(doc(firebaseClient().db, 'organizations', orgId, 'members', user.uid), snapshot => setOwner(snapshot.data()?.role === 'owner'), () => setOwner(false)), [orgId, user.uid]);
  useEffect(() => onSnapshot(query(collection(firebaseClient().db, 'organizations', orgId, 'models'), orderBy('created_at', 'desc'), limit(100)), snapshot => {
    setModels(snapshot.docs.map(doc => ({ ...doc.data(), id: doc.id } as ModelEntry))); setError('');
  }, () => { setModels([]); setError('Chưa đọc được model. Hãy deploy Firestore Rules mới và kiểm tra quyền.'); }), [orgId]);
  const model = selectedModel ? models.find(item => item.id === selectedModel) : models[0];
  const device = devices.find(item => item.id === selectedDevice) || devices[0];
  const pending = device?.model_update;
  const active = pending && ['queued','downloading','loading'].includes(pending.status);
  const disabled = busy || !owner || cached;

  async function upload(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); if (!file || disabled) return;
    setBusy(true); setError(''); setMessage('');
    try {
      if (!file.name.toLowerCase().endsWith('.gwm')) throw new Error('Chọn file model .gwm.');
      if (file.size < 88 || file.size > 1096) throw new Error('File GWM phải có kích thước 88–1096 byte, tối đa 127 node.');
      const bytes = new Uint8Array(await file.arrayBuffer());
      const view = new DataView(bytes.buffer);
      if (new TextDecoder().decode(bytes.subarray(0, 8)) !== 'GW24MODL') throw new Error('File không có header GW24MODL hợp lệ.');
      const version = view.getUint32(16, false);
      const digest = await crypto.subtle.digest('SHA-256', bytes);
      const artifact_sha256 = Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2,'0')).join('');
      const body = { orgId, name, kind: 'model', version, artifact_sha256, artifact_base64: btoa(String.fromCharCode(...bytes)) };
      const result = await modelRequest(user, '/api/models', body);
      setSelectedModel(result.model_id);
      setMessage(result.duplicate ? 'Phiên bản này đã tồn tại. Chọn thiết bị để phát lệnh nạp.' : 'Đã kiểm tra và lưu phiên bản model. Chưa gửi lệnh nạp đến thiết bị.');
    } catch (error) { setError(error instanceof Error ? error.message : 'Không tải được model.'); }
    finally { setBusy(false); }
  }
  async function deploy() {
    if (disabled || !model || !device || active) return;
    if (!window.confirm(`Nạp model “${model.name}” (version ${model.model.version}) vào ${device.id}?\n\nESP sẽ tắt RUN_ENABLE, kiểm tra và nạp model qua SPI. Sau khi nạp, enforcement vẫn TẮT; cần bật lại chủ động tại thiết bị. Thiết bị offline sẽ nhận lệnh khi kết nối lại.`)) return;
    setBusy(true); setError(''); setMessage('');
    if (!requestIdentity.current || requestIdentity.current.device !== device.id || requestIdentity.current.model !== model.id) requestIdentity.current = { device: device.id, model: model.id, id: crypto.randomUUID() };
    try {
      const result = await modelRequest(user, '/api/model-commands', { orgId, deviceId: device.id, modelId: model.id, commandId: requestIdentity.current.id, action: 'deploy' });
      requestIdentity.current = null;
      setMessage(`Lệnh ${result.command_id} đã được lưu. Chờ ESP nhận qua heartbeat; xem trạng thái bên dưới.`);
    } catch (error) {
      if ((error as { status?: number }).status && (error as { status: number }).status < 500) requestIdentity.current = null;
      setError(error instanceof Error ? error.message : 'Không tạo được lệnh. Thử lại sẽ giữ nguyên ID lệnh.');
    } finally { setBusy(false); }
  }
  async function cancel() {
    if (disabled || !device || !pending || !['queued','downloading'].includes(pending.status)) return;
    if (!window.confirm(`Hủy lệnh đang chờ của ${device.id}? Chỉ hủy được trước khi ESP được phép nạp model vào lõi xử lý.`)) return;
    setBusy(true); setError(''); setMessage('');
    try {
      await modelRequest(user, '/api/model-commands', { orgId, deviceId: device.id, commandId: pending.command_id, action: 'cancel' });
      setMessage('Đã hủy lệnh.');
    } catch (error) { setError(error instanceof Error ? error.message : 'Không hủy được lệnh.'); }
    finally { setBusy(false); }
  }

  return <section className="model-panel" aria-labelledby="model-panel-title"><div className="panel-heading"><div><p className="eyebrow">MODEL DEPLOYMENT</p><h2 id="model-panel-title">Nạp model vào lõi IDS</h2></div><span className="device-chip">ABI 1 · 1–127 node</span></div>
    <p className="model-intro">Tải gói trọng số .gwm, chọn thiết bị để nạp qua ESP32. Version được đọc từ header; server và ESP kiểm tra ABI, CRC32 và SHA-256 trước khi nạp. Chỉ báo thành công sau khi lõi xử lý xác nhận version hợp lệ; RUN_ENABLE được giữ thấp.</p>
    {!owner ? <p className="model-note">Bạn đang có quyền xem. Chỉ owner được tải model, phát lệnh và hủy lệnh.</p> : <form className="model-upload" onSubmit={upload}><label>Tên model<input value={name} maxLength={80} required onChange={event => setName(event.target.value)} placeholder="Ví dụ: Gateway24 Model2" disabled={disabled}/></label><label>File model (.gwm)<input type="file" accept=".gwm" required disabled={disabled} onChange={event => {
      const next = event.target.files?.[0] || null; setFile(next); setFileVersion(null); setError('');
      if (!name && next) setName(next.name.replace(/\.gwm$/i,'').slice(0,80));
    }}/></label><label>Version trong file<input readOnly value={fileVersion === null ? '' : `0x${fileVersion.toString(16).padStart(8,'0')} · ${fileVersion}`} placeholder="Tự đọc từ header .gwm"/></label><button type="submit" disabled={disabled || !file || !name.trim()}>{busy ? 'Đang xử lý…' : 'Kiểm tra và lưu model'}</button></form>}
    <p className="model-note">Gateway24 GWM v1 · ABI 1 · 24 feature · cửa sổ 5 giây · tối đa 127 node. <a href="/models/gateway24_model2_5s_v02000001.gwm" download>Tải gói mẫu Gateway24 Model2</a>. Lưu file chưa phát lệnh nạp; chọn thiết bị và bấm nạp ở bên dưới.</p>
    <div className="model-selectors"><label>Phiên bản model<select value={model?.id || ''} disabled={busy || !models.length} onChange={event => setSelectedModel(event.target.value)}>{models.length ? models.map(item => <option key={item.id} value={item.id}>{item.name} · v{item.model.version}</option>) : <option value="">Chưa có model</option>}</select></label><label>Thiết bị nhận<select value={device?.id || ''} disabled={busy || !devices.length} onChange={event => setSelectedDevice(event.target.value)}>{devices.length ? devices.map(item => <option key={item.id} value={item.id}>{item.name} · {item.id}</option>) : <option value="">Chưa có thiết bị</option>}</select></label></div>
    {model ? <div className="model-metadata"><span>ABI <b>{model.model.abi}</b> · Nodes <b>{model.model.node_count}</b> · CRC32 <code>{model.model.crc32}</code></span><span>Payload SHA-256 <code>{model.model.sha256}</code></span>{model.artifact ? <span>GWM · {model.artifact.artifact_size} byte · Artifact SHA-256 <code>{model.artifact.artifact_sha256}</code></span> : null}</div> : null}
    {device?.heartbeat?.firmware_version !== 'ott-ids-1.3.0' ? <p className="model-note">Nạp firmware ESP ott-ids-1.3.0 để tải và kiểm tra trực tiếp gói GWM.</p> : null}
    {owner ? <div className="model-actions"><button type="button" disabled={disabled || !model || !device || !!active} onClick={deploy}>Nạp model vào thiết bị</button>{pending && ['queued','downloading'].includes(pending.status) ? <button type="button" className="secondary" disabled={disabled} onClick={cancel}>Hủy lệnh đang chờ</button> : null}</div> : null}
    {pending ? <p className={`model-current status-${pending.status}`} role="status">Lệnh hiện tại: <strong>{labels[pending.status] || pending.status}</strong> · {pending.name} · v{pending.version}{pending.error ? ` · ${errorLabels[pending.error] || pending.error}` : ''}</p> : null}
    {device?.heartbeat?.fpga ? <p className="model-note">Lõi IDS tại heartbeat cuối: SPI {device.heartbeat.fpga.spi_ready ? 'sẵn sàng' : 'chưa kết nối'}, model {device.heartbeat.fpga.model_valid ? 'hợp lệ' : 'chưa hợp lệ'}, version {device.heartbeat.fpga.active_version}, RUN_ENABLE {device.heartbeat.fpga.run_enabled ? '1' : '0'}.</p> : null}
    {message ? <p className="model-feedback" role="status">{message}</p> : null}{error ? <p className="model-feedback error" role="alert">{error}</p> : null}
    {device ? <CommandHistory key={device.id} orgId={orgId} deviceId={device.id}/> : null}
  </section>;
}
