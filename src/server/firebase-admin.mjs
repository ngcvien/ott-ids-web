import { applicationDefault, cert, getApps, initializeApp } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';

// Import only from server routes / trusted local scripts. Never from a Client Component.
export function adminDatabase() {
  const projectId = process.env.FIREBASE_PROJECT_ID || process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID;
  if (!projectId) throw new Error('Missing Firebase project ID');
  if (process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID && projectId !== process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID) {
    throw new Error('Server and browser Firebase projects do not match');
  }
  const name = 'lastdance-server';
  let app = getApps().find(app => app.name === name);
  if (!app) {
    const clientEmail = process.env.FIREBASE_CLIENT_EMAIL;
    const privateKey = process.env.FIREBASE_PRIVATE_KEY;
    if (Boolean(clientEmail) !== Boolean(privateKey)) throw new Error('Incomplete Firebase server credentials');
    // Emulator needs no credential; tests always use a demo project ID.
    const options = process.env.FIRESTORE_EMULATOR_HOST
      ? { projectId }
      : { projectId, credential: clientEmail && privateKey
        ? cert({ projectId, clientEmail, privateKey: privateKey.replace(/\\n/g, '\n') })
        : applicationDefault() };
    app = initializeApp(options, name);
  }
  return getFirestore(app);
}
