import type { Metadata } from 'next';
import '@fontsource/be-vietnam-pro/400.css';
import '@fontsource/be-vietnam-pro/500.css';
import '@fontsource/be-vietnam-pro/600.css';
import '@fontsource/be-vietnam-pro/700.css';
import './globals.css';

export const metadata: Metadata = {
  title: 'OTT-IDS · Trung tâm giám sát an ninh',
  description: 'OTT-IDS — Giám sát thiết bị và theo dõi cảnh báo an ninh mạng theo thời gian thực.',
  robots: { index: false, follow: false },
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="vi"><body>{children}</body></html>;
}
