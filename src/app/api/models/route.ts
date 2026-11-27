import { adminAuth, adminDatabase } from '@/server/firebase-admin.mjs';
import { uploadModel, modelAdminHttp } from '@/server/models.mjs';

export const runtime = 'nodejs';
export const maxDuration = 30;
export async function POST(request: Request) {
  return modelAdminHttp(request, adminDatabase, (token: string) => adminAuth().verifyIdToken(token, true), uploadModel);
}
