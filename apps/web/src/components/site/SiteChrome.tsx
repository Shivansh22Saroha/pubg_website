import { ATTRIBUTION_TEXT, BGMI_NOTICE, PRODUCT_NAME } from '@rotationlab/shared';
import { Crosshair } from 'lucide-react';
import Link from 'next/link';
import type { ReactNode } from 'react';
import { NavAuth } from './NavAuth';

/** Top nav of the public pages (UI_UX_SPEC §3.1): logo left, auth actions right. */
export function SiteHeader({ children }: { children?: ReactNode }) {
  return (
    <header className="sticky top-0 z-10 border-b-2 border-border-strong bg-bg">
      <div className="mx-auto flex h-14 max-w-6xl items-center gap-2 px-4">
        <Link
          href="/"
          className="flex items-center gap-2 font-display text-lg font-bold tracking-wide"
        >
          <Crosshair className="size-[18px] text-accent" aria-hidden />
          {PRODUCT_NAME}
        </Link>
        <nav aria-label="Account" className="ml-auto flex items-center gap-2">
          {children}
          <NavAuth />
        </nav>
      </div>
    </header>
  );
}

/** Footer of the public pages: the KRAFTON attribution and BGMI notice (brand.ts), legal links. */
export function SiteFooter() {
  return (
    <footer className="border-t px-4 py-8 text-xs text-text-muted">
      <div className="mx-auto flex max-w-6xl flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div className="max-w-xl space-y-1">
          <p>{ATTRIBUTION_TEXT}</p>
          <p>{BGMI_NOTICE}</p>
        </div>
        <nav aria-label="Legal" className="flex flex-wrap gap-x-4 gap-y-2">
          <Link href="/privacy" className="hover:text-text">
            Privacy
          </Link>
          <Link href="/terms" className="hover:text-text">
            Terms
          </Link>
          <a href="/.well-known/security.txt" className="hover:text-text">
            Security contact
          </a>
        </nav>
      </div>
    </footer>
  );
}
