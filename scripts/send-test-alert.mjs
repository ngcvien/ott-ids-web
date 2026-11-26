import { readFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { parseArgs } from 'node:util';

const { values } = parseArgs({ options: {
  credential: { type: 'string' }, server: { type: 'string', default: 'http://localhost:3000' }, repeat: { type: 'boolean', default: false },
} });
if (!values.credential) throw new Error('Pass --credential PATH_TO_DEVICE_KEY_JSON [--server HTTPS_URL] [--repeat]');
const server = new URL(values.server);
if (server.protocol !== 'https:' && !(server.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(server.hostname))) {
  throw new Error('Use HTTPS, except for a local test server');
}
const credential = JSON.parse(await readFile(values.credential, 'utf8'));
if (!credential.deviceId || !credential.deviceKey) throw new Error('Invalid device credential file');
const payload = {
  boot_id: `manual-test-${randomUUID()}`, event_id: '1', timestamp_ms: 0, model_version: 0,
  class_id: 1, ingress_port: 0, src_ip: '192.0.2.10', dst_ip: '192.0.2.20', src_port: 41000,
  dst_port: 40000, protocol: 17, action: 'monitor', tree_error: 0, tree_steps: 0, latency_cycles: 0,
};
for (let attempt = 0; attempt < (values.repeat ? 2 : 1); attempt++) {
  const response = await fetch(new URL('/api/device/alerts', server), { method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Device-ID': credential.deviceId, 'X-Device-Key': credential.deviceKey },
    body: JSON.stringify(payload), signal: AbortSignal.timeout(30000), redirect: 'error',
  });
  const result = await response.json().catch(() => null);
  console.log({ status: response.status, accepted: result?.accepted, duplicate: result?.duplicate, id: result?.id, code: result?.code });
  if (!response.ok || result?.accepted !== true) throw new Error('Test alert not accepted; inspect server logs. Device key was not logged.');
}
console.log('A synthetic manual-test alert was sent. It should appear on the selected device dashboard.');
