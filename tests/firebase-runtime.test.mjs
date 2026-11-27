import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { generateKeyPairSync, sign, verify } from 'node:crypto';

const require = createRequire(import.meta.url);

test('Firebase app, Firestore and Auth load when require(ESM) is disabled on the runtime', async () => {
  assert.equal(process.features.require_module, false, 'Run via npm run test:runtime to reproduce the Vercel runtime restriction');
  assert.equal(typeof require('firebase-admin/app').initializeApp, 'function');
  assert.equal(typeof require('firebase-admin/firestore').getFirestore, 'function');
  assert.equal(typeof require('firebase-admin/auth').getAuth, 'function');
  const shared = await import('../src/server/firebase-admin.mjs');
  assert.equal(typeof shared.adminDatabase, 'function');
  assert.equal(typeof shared.adminAuth, 'function');
});

test('Firebase Auth JWKS dependency imports an RSA public key and verifies a real signature without network or credentials', async () => {
  const fromAuth = createRequire(require.resolve('firebase-admin/auth'));
  const jwksClient = fromAuth('jwks-rsa');
  const { publicKey, privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
  const jwk = { ...publicKey.export({ format: 'jwk' }), kid: 'runtime-test', use: 'sig', alg: 'RS256' };
  // The injectable fetcher exercises jwks-rsa -> jose importJWK/export code without
  // reaching a real identity provider. Generated keys exist only in this process.
  const client = jwksClient({ jwksUri: 'https://unused.invalid', fetcher: async () => ({ keys: [jwk] }) });
  const key = await client.getSigningKey('runtime-test');
  const input = Buffer.from('OTT-IDS runtime compatibility');
  const signature = sign('RSA-SHA256', input, privateKey);
  assert.equal(verify('RSA-SHA256', input, key.getPublicKey(), signature), true);
  assert.equal(verify('RSA-SHA256', Buffer.from('tampered'), key.getPublicKey(), signature), false);
});
