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
/** the header's call to action: the amber glass-theme button, centred in the bar */
const BLOCK = buttonVariants({ variant: 'accent', className: 'my-auto h-10 px-4' });
const LINK =
  'my-auto flex h-10 items-center rounded-[10px] px-3 text-sm font-semibold whitespace-nowrap text-text hover:bg-white/[0.06] sm:px-4';

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
