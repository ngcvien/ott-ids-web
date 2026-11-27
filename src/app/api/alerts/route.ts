import { adminAuth, adminDatabase } from '@/server/firebase-admin.mjs';
import { handleClear } from '@/server/clear-alerts.mjs';

export const runtime = 'nodejs';
export const maxDuration = 30;

export async function DELETE(request: Request) {
  return handleClear(request, adminDatabase, (token: string) => adminAuth().verifyIdToken(token, true));
}
