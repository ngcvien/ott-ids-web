import { readFile } from 'node:fs/promises';
import { after, before, test } from 'node:test';
import { initializeTestEnvironment, assertFails, assertSucceeds } from '@firebase/rules-unit-testing';
import { collection, deleteDoc, doc, getDoc, getDocs, limit, orderBy, query, setDoc, Timestamp, updateDoc } from 'firebase/firestore';

let env;
before(async () => {
  env = await initializeTestEnvironment({ projectId: 'demo-lastdance', firestore: {
    host: '127.0.0.1', port: 8085, rules: await readFile(new URL('../firestore.rules', import.meta.url), 'utf8'),
  } });
  await env.withSecurityRulesDisabled(async context => {
    const db = context.firestore();
    for (const [uid, org] of [['alice', 'org-a'], ['bob', 'org-b']]) {
      await setDoc(doc(db, `users/${uid}/memberships/${org}`), { name: org, role: 'owner' });
      await setDoc(doc(db, `organizations/${org}/members/${uid}`), { role: 'owner' });
      await setDoc(doc(db, `organizations/${org}/devices/IDS-0001`), { name: 'Sensor' });
      await setDoc(doc(db, `organizations/${org}/devices/IDS-0001/alerts/event-1`), { class_id: 1, received_at: Timestamp.now() });
    }
    await setDoc(doc(db, 'deviceCredentials/IDS-0001'), { keyHash: 'never-public' });
  });
});
after(async () => { await env?.cleanup(); });

const alertPath = 'organizations/org-a/devices/IDS-0001/alerts';
test('member reads own memberships, devices and bounded realtime query', async () => {
  const db = env.authenticatedContext('alice').firestore();
  await assertSucceeds(getDocs(collection(db, 'users/alice/memberships')));
  await assertSucceeds(getDocs(collection(db, 'organizations/org-a/devices')));
  await assertSucceeds(getDocs(query(collection(db, alertPath), orderBy('received_at', 'desc'), limit(100))));
  await assertFails(getDocs(collection(db, alertPath)));
});
test('another customer and an authenticated unassigned user cannot read alerts', async () => {
  for (const uid of ['bob', 'unassigned']) {
    const db = env.authenticatedContext(uid).firestore();
    await assertFails(getDoc(doc(db, `${alertPath}/event-1`)));
    await assertFails(getDocs(query(collection(db, alertPath), limit(100))));
    await assertFails(getDocs(collection(db, 'users/alice/memberships')));
  }
});
test('anonymous cannot read membership, devices or alerts', async () => {
  const db = env.unauthenticatedContext().firestore();
  await assertFails(getDoc(doc(db, `${alertPath}/event-1`)));
  await assertFails(getDocs(collection(db, 'organizations/org-a/devices')));
  await assertFails(getDocs(collection(db, 'users/alice/memberships')));
});
test('even an owner cannot forge alerts, grant access, or read credentials', async () => {
  const db = env.authenticatedContext('alice').firestore();
  await assertFails(setDoc(doc(db, `${alertPath}/forged`), { class_id: 1 }));
  await assertFails(updateDoc(doc(db, `${alertPath}/event-1`), { class_id: 2 }));
  await assertFails(deleteDoc(doc(db, `${alertPath}/event-1`)));
  await assertFails(setDoc(doc(db, 'organizations/org-b/members/alice'), { role: 'owner' }));
  await assertFails(setDoc(doc(db, 'users/alice/memberships/org-b'), { role: 'owner' }));
  await assertFails(getDoc(doc(db, 'deviceCredentials/IDS-0001')));
});
test('removing authoritative membership revokes access despite stale discovery data', async () => {
  await env.withSecurityRulesDisabled(async context => {
    await deleteDoc(doc(context.firestore(), 'organizations/org-a/members/alice'));
  });
  const db = env.authenticatedContext('alice').firestore();
  await assertFails(getDoc(doc(db, `${alertPath}/event-1`)));
});
