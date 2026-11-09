'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { buttonVariants } from '@/components/ui/button';

/**
 * The landing page's only client JS. A plain status check of `GET /me` — no React Query, no
 * schema parsing — so the public pages don't ship the app's data layer (Phase 9 bundle
 * budget). One request per page load, shared by the nav and the hero CTA. An expired access
 * cookie reads as logged out; "Log in" then refreshes silently and lands on the dashboard.
 */
let session: Promise<boolean> | null = null;
const signedIn = () =>
  (session ??= fetch('/api/v1/me', { credentials: 'include', cache: 'no-store' })
    .then((r) => r.ok)
    .catch(() => false));

function useSignedIn(): boolean {
  const [yes, setYes] = useState(false);
  useEffect(() => {
    let live = true;
    void signedIn().then((v) => {
      if (live) setYes(v);
    });
    return () => {
      live = false;
    };
  }, []);
  return yes;
}

/** Logged in: "Go to dashboard"; otherwise (and while checking) Log in / Get started. */
/** the header's call to action: a full-height gold block flush with the right edge */
const BLOCK =
  'bgmi-halftone flex items-center px-4 pt-[4px] font-display text-[20px] leading-none tracking-[0.03em] whitespace-nowrap text-accent-fg uppercase hover:brightness-110 sm:px-9 sm:text-[26px]';
const LINK =
  'flex items-center px-3 pt-[4px] font-display text-[20px] leading-none tracking-[0.03em] whitespace-nowrap text-text uppercase hover:text-accent sm:px-5 sm:text-[21px]';

export function NavAuth() {
  if (useSignedIn()) {
    return (
      <Link href="/dashboard" className={BLOCK}>
        Go to dashboard
      </Link>
    );
  }
  return (
    <>
      <Link href="/login" className={LINK}>
        Log in
      </Link>
      <Link href="/register" className={BLOCK}>
        Get started
      </Link>
    </>
  );
}

/** Hero CTA: a new room needs an account — register, or straight to the dashboard. */
export function CreateRoomCta({
  className,
  label = 'Create a room',
}: {
  className?: string;
  label?: string;
}) {
  return (
    <Link
      href={useSignedIn() ? '/dashboard' : '/register'}
      className={buttonVariants({ variant: 'accent', className })}
    >
      {label}
    </Link>
  );
}
