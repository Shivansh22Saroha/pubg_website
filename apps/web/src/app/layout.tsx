import { PRODUCT_NAME } from '@rotationlab/shared';
import type { Metadata, Viewport } from 'next';
import { Inter, JetBrains_Mono, Rajdhani } from 'next/font/google';
import type { ReactNode } from 'react';
import '@/env';
import './globals.css';

const rajdhani = Rajdhani({
  subsets: ['latin'],
  weight: ['600', '700'],
  variable: '--font-rajdhani',
  display: 'swap',
});
const inter = Inter({ subsets: ['latin'], variable: '--font-inter', display: 'swap' });
const jetbrainsMono = JetBrains_Mono({
  subsets: ['latin'],
  weight: ['500'],
  variable: '--font-jetbrains-mono',
  display: 'swap',
});

export const metadata: Metadata = {
  title: { default: PRODUCT_NAME, template: `%s · ${PRODUCT_NAME}` },
  description: 'Real-time collaborative tactical map sandbox for BGMI / PUBG squads.',
};

export const viewport: Viewport = {
  themeColor: '#0B0F14',
  colorScheme: 'dark',
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html
      lang="en"
      className={`dark ${rajdhani.variable} ${inter.variable} ${jetbrainsMono.variable}`}
    >
      <body className="min-h-dvh bg-bg text-text">{children}</body>
    </html>
  );
}
