import { adminDatabase } from '@/server/firebase-admin.mjs';
import { handleHeartbeat } from '@/server/heartbeat.mjs';

export const runtime = 'nodejs';
export const maxDuration = 30;

export async function POST(request: Request) {
  return handleHeartbeat(request, adminDatabase);
}
