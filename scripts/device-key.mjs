import { randomBytes, randomUUID } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { FieldValue } from 'firebase-admin/firestore';
import { adminDatabase } from '../src/server/firebase-admin.mjs';
import { hashKey, validId } from '../src/server/alerts.mjs';

const { values } = parseArgs({ options: {
  org: { type: 'string' }, device: { type: 'string' }, rotate: { type: 'boolean' }, disable: { type: 'boolean' },
} });
if (!validId(values.org) || !validId(values.device) || (values.rotate && values.disable)) {
  throw new Error('Usage: npm run device:key -- --org ORG --device ID [--rotate | --disable]');
}
const db = adminDatabase();
const credentialRef = db.doc(`deviceCredentials/${values.device}`);
if (values.disable) {
  await db.runTransaction(async transaction => {
    const credential = (await transaction.get(credentialRef)).data();
    if (!credential || credential.orgId !== values.org) throw new Error('Device is not registered in this organization');
    transaction.update(credentialRef, { enabled: false, updatedAt: FieldValue.serverTimestamp() });
  });
  console.log(`Disabled ${values.device}. Existing alerts were retained.`);
} else {
  // Reject routine mistakes before generating a new secret file. The transaction
  // below still repeats these checks to protect against concurrent registration.
  const previous = await credentialRef.get();
  if (previous.exists && previous.data().orgId !== values.org) throw new Error('Device ID belongs to another organization');
  if (previous.exists && !values.rotate) throw new Error('Credential already exists; use --rotate explicitly to replace its key');
  if (!previous.exists && values.rotate) throw new Error('No existing credential; omit --rotate for first registration');
  const key = randomBytes(32).toString('base64url');
  // Unique file per issuance: never overwrite the only copy of a current key.
  const file = resolve('.device-secrets', `${values.device}-${randomUUID()}.json`);
  await mkdir(dirname(file), { recursive: true });
  await writeFile(file, JSON.stringify({ deviceId: values.device, deviceKey: key, orgId: values.org }, null, 2) + '\n', { flag: 'wx', mode: 0o600 });
  try {
    await db.runTransaction(async transaction => {
      const [credential, device, org] = await transaction.getAll(credentialRef,
        db.doc(`organizations/${values.org}/devices/${values.device}`), db.doc(`organizations/${values.org}`));
      if (!device.exists || !org.exists) throw new Error('Create the organization/device using bootstrap first');
      if (credential.exists && credential.data().orgId !== values.org) throw new Error('Device ID belongs to another organization');
      if (credential.exists && !values.rotate) throw new Error('Credential already exists; use --rotate explicitly to replace its key');
      if (!credential.exists && values.rotate) throw new Error('No existing credential; omit --rotate for first registration');
      transaction.set(credentialRef, { orgId: values.org, keyHash: hashKey(key), enabled: true, updatedAt: FieldValue.serverTimestamp() });
    });
  } catch (error) {
    // A network error can occur after Firestore committed. Retain the candidate
    // key instead of deleting the only possible copy of an active credential.
    console.error(`Registration failed or was not confirmed. Candidate key retained at: ${file}`);
    throw error;
  }
  console.log(`${values.rotate ? 'Rotated and enabled' : 'Registered'} ${values.device}. Secret saved locally: ${file}`);
  console.log('Copy deviceId/deviceKey to the ESP32 configuration. Never upload this file or paste its contents into chat.');
}
