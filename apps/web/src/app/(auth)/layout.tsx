import Link from 'next/link';
import type { ReactNode } from 'react';
import { env } from '@/env';
import { Wordmark } from '@/components/site/SiteChrome';
import { Providers } from '../providers';

const backdrop = `${env.NEXT_PUBLIC_TILES_BASE_URL.replace(/\/$/, '')}/erangel/preview.jpg`;

/** UI_UX_SPEC §3.2: centred 400 px card on --bg with a blurred, darkened map behind. */
export default function AuthLayout({ children }: { children: ReactNode }) {
  return (
    <div className="relative isolate flex min-h-dvh items-center justify-center overflow-hidden px-4 py-12">
      <div
        aria-hidden
        className="absolute inset-0 -z-10 scale-105 bg-cover bg-center opacity-45 saturate-[0.8]"
        style={{ backgroundImage: `url(${backdrop})` }}
      />
      {/* the map grid over the art, then a vignette into the page colour */}
      <div
        aria-hidden
        className="absolute inset-0 -z-10 bg-[linear-gradient(rgba(255,255,255,0.05)_1px,transparent_1px),linear-gradient(90deg,rgba(255,255,255,0.05)_1px,transparent_1px)] bg-[size:12.5vmax_12.5vmax]"
      />
      <div
        aria-hidden
        className="absolute inset-0 -z-10 bg-[radial-gradient(ellipse_at_center,rgba(0,0,0,0.55)_0%,var(--bg)_72%)]"
      />
      <div className="relative w-full max-w-[400px]">
        <Link href="/" className="mx-auto mb-7 flex w-fit rounded-control">
          <Wordmark className="text-2xl" />
        </Link>
        <div className="glass rounded-hero p-7">
          <Providers>{children}</Providers>
        </div>
      </div>
    </div>
  );
}
