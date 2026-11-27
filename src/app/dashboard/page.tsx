import type { Metadata } from 'next';
import { AlertConsole } from '@/components/alert-console';

export const metadata: Metadata = { title: 'Dashboard · OTT-IDS', robots: { index: false, follow: false } };

export default function DashboardPage() {
  return <AlertConsole />;
}
