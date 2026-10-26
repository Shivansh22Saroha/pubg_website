import { PRODUCT_NAME } from '@rotationlab/shared';
import { Crosshair } from 'lucide-react';
import Link from 'next/link';
import type { ReactNode } from 'react';
import { env } from '@/env';
import { Providers } from '../providers';

const backdrop = `${env.NEXT_PUBLIC_TILES_BASE_URL.replace(/\/$/, '')}/erangel/preview.jpg`;

/** UI_UX_SPEC §3.2: centred 400 px card on --bg with a blurred, darkened map behind. */
export default function AuthLayout({ children }: { children: ReactNode }) {
  return (
    <div className="relative flex min-h-dvh items-center justify-center overflow-hidden px-4 py-12">
      <div
        aria-hidden
        className="absolute inset-0 scale-110 bg-cover bg-center opacity-30 blur-md"
        style={{ backgroundImage: `url(${backdrop})` }}
      />
      <div
        aria-hidden
        className="absolute inset-0 bg-[radial-gradient(ellipse_at_center,transparent_0%,var(--bg)_75%)]"
      />
      <div className="relative w-full max-w-[400px]">
        <Link
          href="/"
          className="mb-6 flex items-center justify-center gap-2 font-display text-2xl font-bold"
        >
          <Crosshair className="size-5 text-accent" aria-hidden />
          {PRODUCT_NAME}
        </Link>
        <div className="rounded-panel border bg-surface p-6 shadow-panel">
          <Providers>{children}</Providers>
        </div>
      </div>
    </div>
  );
}
