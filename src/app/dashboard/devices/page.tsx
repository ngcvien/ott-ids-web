import type { Metadata } from 'next';
import { AlertConsole } from '@/components/alert-console';

export const metadata: Metadata = { title: 'Thiết bị · OTT-IDS', robots: { index: false, follow: false } };

export default function DevicesPage() {
  return <AlertConsole view="devices" />;
}
