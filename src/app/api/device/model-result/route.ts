import { adminDatabase } from '@/server/firebase-admin.mjs';
import { reportModelResult, modelDeviceHttp } from '@/server/models.mjs';

export const runtime = 'nodejs';
export const maxDuration = 30;
export async function POST(request: Request) {
  return modelDeviceHttp(request, adminDatabase, reportModelResult);
}
