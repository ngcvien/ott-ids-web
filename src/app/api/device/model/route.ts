import { adminDatabase } from '@/server/firebase-admin.mjs';
import { downloadDeviceArtifact, downloadDeviceModel, modelDeviceHttp } from '@/server/models.mjs';

export const runtime = 'nodejs';
export const maxDuration = 30;
export async function POST(request: Request) {
  const binary = request.headers.get('accept')?.includes('application/vnd.gateway24.model');
  return modelDeviceHttp(request, adminDatabase, binary ? downloadDeviceArtifact : downloadDeviceModel);
}
