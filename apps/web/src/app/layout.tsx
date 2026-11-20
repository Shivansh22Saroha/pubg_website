import { PRODUCT_NAME } from '@rotationlab/shared';
import type { Metadata, Viewport } from 'next';
import { Chakra_Petch, Inter, JetBrains_Mono } from 'next/font/google';
import { connection } from 'next/server';
import type { ReactNode } from 'react';
import '@/env';
import { Spotter } from '@/components/spotter/Spotter';
import { serverEnv } from '@/lib/serverEnv';
import './globals.css';

// Glass theme (2026-11, UI_UX_SPEC §2.3): a squared techy display face for headings, numbers and
// the room title — set in normal case; Inter for everything else
const chakra = Chakra_Petch({
  subsets: ['latin'],
  weight: ['500', '600', '700'],
  variable: '--font-display-face',
  display: 'swap',
});
const inter = Inter({ subsets: ['latin'], variable: '--font-inter', display: 'swap' });
const jetbrainsMono = JetBrains_Mono({
  subsets: ['latin'],
  weight: ['500'],
  variable: '--font-jetbrains-mono',
  display: 'swap',
  // coordinates / badges in the room only: not worth a preload on every page (Phase 9)
  preload: false,
});

export const metadata: Metadata = {
  title: { default: PRODUCT_NAME, template: `%s · ${PRODUCT_NAME}` },
  description: 'Real-time collaborative tactical map sandbox for BGMI / PUBG squads.',
};

export const viewport: Viewport = {
  themeColor: '#000000',
  colorScheme: 'dark',
};

export default async function RootLayout({ children }: { children: ReactNode }) {
  // every page renders per request: the CSP nonce from src/proxy.ts only reaches the scripts of a
  // dynamically rendered page (a prerendered one would carry no nonce and be blocked)
  await connection();
  return (
    <html
      lang="en"
      className={`dark ${chakra.variable} ${inter.variable} ${jetbrainsMono.variable}`}
    >
      <body className="min-h-dvh bg-bg text-text">
        {serverEnv().MAINTENANCE && (
          <p
            role="status"
            data-testid="maintenance-banner"
            className="bg-warning px-4 py-2 text-center text-sm font-medium text-bg"
          >
            RotationLab is down for maintenance. Saving is paused — back shortly.
          </p>
        )}
        {children}
        <Spotter />
      </body>
    </html>
  );
}
