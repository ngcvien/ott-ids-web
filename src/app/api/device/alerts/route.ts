import { adminDatabase } from '@/server/firebase-admin.mjs';
import { handleAlert } from '@/server/alerts.mjs';

export const runtime = 'nodejs';
export const maxDuration = 30;

export async function POST(request: Request) {
  return handleAlert(request, adminDatabase);
}
