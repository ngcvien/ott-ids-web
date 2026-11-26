import { applicationDefault, initializeApp } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { FieldValue, getFirestore } from 'firebase-admin/firestore';
import { parseArgs } from 'node:util';

// Local trusted-admin operation. No browser can call this script.
const { values } = parseArgs({ options: {
  uid: { type: 'string' }, org: { type: 'string' }, name: { type: 'string' },
  device: { type: 'string' }, 'device-name': { type: 'string' },
} });
const projectId = process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID;
const uid = values.uid;
const orgId = values.org;
const validId = value => typeof value === 'string' && /^[A-Za-z0-9_-]{1,128}$/.test(value);
if (!projectId || !validId(uid) || !validId(orgId) || (values.device && !validId(values.device))) {
  throw new Error('Set NEXT_PUBLIC_FIREBASE_PROJECT_ID and pass --uid UID --org ORG_ID [--name NAME] [--device ID --device-name NAME]. IDs: letters, digits, dash, underscore.');
}
initializeApp({ credential: applicationDefault(), projectId });
const user = await getAuth().getUser(uid); // Fail before creating anything if UID is wrong.
const db = getFirestore();
const org = db.doc(`organizations/${orgId}`);
const member = org.collection('members').doc(uid);
const membership = db.doc(`users/${uid}/memberships/${orgId}`);
await db.runTransaction(async transaction => {
  const existingOrg = await transaction.get(org);
  const name = values.name || existingOrg.data()?.name || orgId;
  transaction.set(org, { name, updatedAt: FieldValue.serverTimestamp() }, { merge: true });
  transaction.set(member, { role: 'owner', updatedAt: FieldValue.serverTimestamp() }, { merge: true });
  transaction.set(membership, { name, role: 'owner' });
  if (values.device) {
    transaction.set(org.collection('devices').doc(values.device), {
      name: values['device-name'] || values.device, deviceId: values.device,
    }, { merge: true });
  }
});
console.log(`Granted owner access to ${user.uid} in ${orgId}${values.device ? `; registered display device ${values.device}` : ''}.`);
console.log('No device credential or alert was created. Use npm run device:key to issue a separate ingestion credential.');
