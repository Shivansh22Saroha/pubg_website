'use client';

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useState, type ReactNode } from 'react';
import { Toaster } from 'sonner';
import { WakingServer } from '@/components/motion/WakingServer';
import { ApiError } from '@/lib/api';

export function Providers({ children }: { children: ReactNode }) {
  const [client] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            staleTime: 30_000,
            // auth / permission errors are final; only retry transient failures
            retry: (count, err) => !(err instanceof ApiError && err.status < 500) && count < 2,
          },
        },
      }),
  );
  return (
    <QueryClientProvider client={client}>
      {children}
      <WakingServer />
      {/* UI_UX_SPEC §9: bottom-left, max 3, 4 s */}
      <Toaster
        position="bottom-left"
        visibleToasts={3}
        duration={4000}
        theme="dark"
        // glass layout: frosted pills like the room demo's notices
        toastOptions={{
          classNames: {
            toast:
              '!rounded-[14px] !border !border-[var(--edge-strong)] !bg-[var(--glass)] !text-text !backdrop-blur-xl !shadow-[0_18px_40px_-18px_rgba(0,0,0,0.8)]',
            description: '!text-text-muted',
          },
        }}
      />
    </QueryClientProvider>
  );
}
