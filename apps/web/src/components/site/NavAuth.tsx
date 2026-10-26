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
export function NavAuth() {
  if (useSignedIn()) {
    return (
      <Link href="/dashboard" className={buttonVariants({ variant: 'accent', size: 'sm' })}>
        Go to dashboard
      </Link>
    );
  }
  return (
    <>
      <Link href="/login" className={buttonVariants({ variant: 'ghost', size: 'sm' })}>
        Log in
      </Link>
      <Link href="/register" className={buttonVariants({ variant: 'accent', size: 'sm' })}>
        Get started
      </Link>
    </>
  );
}

/** Hero CTA: a new room needs an account — register, or straight to the dashboard. */
export function CreateRoomCta({ className }: { className?: string }) {
  return (
    <Link
      href={useSignedIn() ? '/dashboard' : '/register'}
      className={buttonVariants({ variant: 'accent', className })}
    >
      Create a room
    </Link>
  );
}
