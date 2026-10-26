import type { ReactNode } from 'react';
import { SiteFooter, SiteHeader } from '@/components/site/SiteChrome';

/** Plain public pages (Privacy, Terms): site nav + footer around readable prose. */
export default function SiteLayout({ children }: { children: ReactNode }) {
  return (
    <div className="flex min-h-dvh flex-col">
      <SiteHeader />
      <main className="mx-auto w-full max-w-2xl flex-1 px-4 py-12">{children}</main>
      <SiteFooter />
    </div>
  );
}
