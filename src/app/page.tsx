import { LandingPage } from '@/components/landing-page';
import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'OTT-IDS · Từ tín hiệu đến tầm nhìn an ninh',
  description: 'Hướng đến thiết kế vi mạch bảo mật, kết nối lõi IDS, ESP32 và cloud. Khám phá nền tảng OTT-IDS và trung tâm giám sát cảnh báo an ninh mạng.',
};

export default function Home() {
  return <LandingPage />;
}
