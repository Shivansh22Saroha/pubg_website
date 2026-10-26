import type { ReactNode } from 'react';
import { AppShell } from '@/components/auth/AppShell';
import { Providers } from '../providers';

export default function AppLayout({ children }: { children: ReactNode }) {
  return (
    <Providers>
      <AppShell>{children}</AppShell>
    </Providers>
  );
}
