import { UserResponseSchema } from '@rotationlab/shared';
import { HydrationBoundary } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { AppShell } from '@/components/auth/AppShell';
import { ME_QUERY_KEY } from '@/lib/queryKeys';
import { dehydrated, prefetchApi, requestContext } from '@/lib/serverApi';
import { Providers } from '../providers';

export default async function AppLayout({ children }: { children: ReactNode }) {
  // seeded above AppShell: hydrating /me inside a page would come after AppShell's own query
  const me = await prefetchApi('/me', UserResponseSchema, await requestContext());
  return (
    <Providers>
      <HydrationBoundary state={dehydrated([[ME_QUERY_KEY, me?.user]])}>
        <AppShell>{children}</AppShell>
      </HydrationBoundary>
    </Providers>
  );
}
