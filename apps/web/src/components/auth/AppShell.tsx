'use client';

import { PRODUCT_NAME } from '@rotationlab/shared';
import { Crosshair, Loader2 } from 'lucide-react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useEffect, type ReactNode } from 'react';
import { useMe } from '@/hooks/useMe';
import { ApiError } from '@/lib/api';
import { VerifyBanner } from './EmailFlows';
import { UserMenu } from './UserMenu';

/**
 * Shell for the logged-in area. The proxy only checks cookie presence; this confirms the
 * session with GET /me and sends the user to /login if it is really gone.
 */
export function AppShell({ children }: { children: ReactNode }) {
  const me = useMe();
  const router = useRouter();
  const pathname = usePathname();
  const unauthenticated = me.error instanceof ApiError && me.error.status === 401;

  useEffect(() => {
    if (unauthenticated) router.replace(`/login?redirectTo=${encodeURIComponent(pathname)}`);
  }, [unauthenticated, pathname, router]);

  // the room workspace brings its own full-screen chrome (UI_UX_SPEC §3.5)
  // (it shows its own loader until /me and the room arrive, both fetched in parallel)
  if (pathname.startsWith('/rooms/')) return children;

  return (
    <div className="flex min-h-dvh flex-col">
      <header className="flex h-12 shrink-0 items-center gap-4 border-b px-4">
        <Link href="/dashboard" className="flex items-center gap-2 font-display text-lg font-bold">
          <Crosshair className="size-[18px] text-accent" aria-hidden />
          {PRODUCT_NAME}
        </Link>
        <div className="ml-auto">{me.data && <UserMenu user={me.data} />}</div>
      </header>
      {me.data && <VerifyBanner verified={me.data.emailVerified} />}
      <main className="flex-1">
        {me.error && !unauthenticated ? (
          <p role="alert" className="p-8 text-center text-danger">
            Could not load your account. Please refresh.
          </p>
        ) : (
          <>
            {!me.data && (
              <p
                role="status"
                className="flex items-center justify-center gap-2 p-8 text-text-muted"
              >
                <Loader2 className="size-4 animate-spin" aria-hidden /> Loading…
              </p>
            )}
            {/* mounted while /me is in flight so the page's own queries (e.g. /rooms) start in
                parallel instead of after it; pages render nothing until they have the user */}
            {!me.error && children}
          </>
        )}
      </main>
    </div>
  );
}
