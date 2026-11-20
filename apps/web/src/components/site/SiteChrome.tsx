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
        'flex items-center gap-2 font-display text-[20px] leading-none font-bold tracking-[0.01em]',
        className,
      )}
    >
      <BrandMark className="size-6" />
      <span>{PRODUCT_NAME}</span>
    </span>
  );
}

/** primary nav of the public pages: caps links like the game site's top bar */
const NAV = [
  { href: '/explore', label: 'Explore' },
  { href: '/explore?map=erangel', label: 'Erangel' },
  { href: '/explore?map=miramar', label: 'Miramar' },
  { href: '/explore?map=rondo', label: 'Rondo' },
] as const;

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
        'sticky top-0 z-20 border-b border-[var(--edge)] backdrop-blur-xl backdrop-saturate-150',
        overlay ? 'bg-[var(--glass)]' : 'bg-bg/70',
      )}
    >
      <div
        className={cn('flex h-16 items-stretch gap-3 px-4 sm:gap-6 sm:px-8', !wide && 'mx-auto')}
      >
        <Link href="/" className="flex min-w-0 items-center rounded-control">
          <Wordmark className="max-[400px]:text-[17px]" />
        </Link>
        <nav aria-label="Primary" className="hidden items-stretch gap-1 lg:flex">
          {NAV.map((n) => (
            <Link
              key={n.href}
              href={n.href}
              className="my-auto flex h-10 items-center rounded-[10px] px-3 text-sm font-semibold text-text-muted transition-colors hover:bg-white/[0.06] hover:text-text"
            >
              {n.label}
            </Link>
          ))}
        </nav>
        <nav aria-label="Account" className="ml-auto flex items-stretch gap-1">
          {children && <div className="flex items-center gap-2 pr-3">{children}</div>}
          <NavAuth />
        </nav>
      </div>
    </header>
  );
}

/** Footer of the public pages: the KRAFTON attribution and BGMI notice (brand.ts), legal links. */
export function SiteFooter() {
  return (
    <footer className="border-t border-[var(--edge)] bg-bg/60 px-4 py-12 text-xs leading-relaxed text-text-muted backdrop-blur-xl">
      <div className="mx-auto flex max-w-6xl flex-col gap-8 sm:flex-row sm:items-start sm:justify-between">
        <div className="flex max-w-xl flex-col gap-4">
          <Wordmark className="text-[20px] text-text" />
          <div className="space-y-1">
            <p>{ATTRIBUTION_TEXT}</p>
            <p>{BGMI_NOTICE}</p>
          </div>
        </div>
        <nav
          aria-label="Legal"
          className="flex flex-wrap gap-x-6 gap-y-2 text-sm font-semibold text-text"
        >
          <Link href="/privacy" className="hover:text-accent">
            Privacy
          </Link>
          <Link href="/terms" className="hover:text-accent">
            Terms
          </Link>
          <a href="/.well-known/security.txt" className="hover:text-accent">
            Security contact
          </a>
        </nav>
      </div>
    </footer>
  );
}
