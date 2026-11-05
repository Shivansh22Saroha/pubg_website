import { ATTRIBUTION_TEXT, BGMI_NOTICE, PRODUCT_NAME } from '@rotationlab/shared';
import Link from 'next/link';
import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';
import { NavAuth } from './NavAuth';

/** Brand mark: a scope reticle in the HUD amber, drawn to sit on the wordmark's cap height. */
export function BrandMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" aria-hidden className={cn('size-5', className)}>
      <circle cx="12" cy="12" r="8.5" fill="none" stroke="var(--accent)" strokeWidth="2" />
      <circle cx="12" cy="12" r="2.4" fill="var(--accent)" />
      <path
        d="M12 1.5v5M12 17.5v5M1.5 12h5M17.5 12h5"
        stroke="var(--accent)"
        strokeWidth="2"
        strokeLinecap="round"
      />
    </svg>
  );
}

export function Wordmark({ className }: { className?: string }) {
  return (
    <span
      className={cn(
        'flex items-center gap-2 font-display text-[19px] font-bold tracking-[0.02em]',
        className,
      )}
    >
      <BrandMark />
      {PRODUCT_NAME}
    </span>
  );
}

/**
 * Top nav of the public pages (UI_UX_SPEC §3.1): logo left, auth actions right. `overlay`: the
 * landing page — transparent over the hero map, with a soft dark fade for legibility.
 */
export function SiteHeader({
  children,
  overlay = false,
  wide = false,
}: {
  children?: ReactNode;
  overlay?: boolean;
  /** full-width map pages (explore, shared boards): align with the edge-to-edge content */
  wide?: boolean;
}) {
  return (
    <header
      className={cn(
        'sticky top-0 z-20',
        overlay
          ? 'bg-[linear-gradient(180deg,rgba(9,12,17,0.85),rgba(9,12,17,0))]'
          : 'border-b bg-bg/80 backdrop-blur-md',
      )}
    >
      <div className={cn('mx-auto flex h-16 items-center gap-2 px-4', !wide && 'max-w-6xl')}>
        <Link href="/" className="rounded-control">
          <Wordmark />
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
    <footer className="border-t bg-surface/40 px-4 py-10 text-xs leading-relaxed text-text-muted">
      <div className="mx-auto flex max-w-6xl flex-col gap-6 sm:flex-row sm:items-start sm:justify-between">
        <div className="flex max-w-xl flex-col gap-3">
          <Wordmark className="text-base text-text" />
          <div className="space-y-1">
            <p>{ATTRIBUTION_TEXT}</p>
            <p>{BGMI_NOTICE}</p>
          </div>
        </div>
        <nav aria-label="Legal" className="flex flex-wrap gap-x-5 gap-y-2 text-[13px]">
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
