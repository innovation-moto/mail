import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'Mail',
  description: 'AI-powered mail client',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ja" suppressHydrationWarning>
      <body>{children}</body>
    </html>
  );
}
