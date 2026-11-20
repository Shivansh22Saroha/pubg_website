'use client';

import { Tabs as TabsPrimitive } from 'radix-ui';
import type { ComponentProps } from 'react';
import { cn } from '@/lib/utils';

export const Tabs = TabsPrimitive.Root;

export function TabsList({ className, ...props }: ComponentProps<typeof TabsPrimitive.List>) {
  // glass theme: a segmented control, like the demo's sheet tabs
  return (
    <TabsPrimitive.List
      className={cn('mx-2 mt-2 flex gap-1 rounded-[12px] bg-white/[0.04] p-1', className)}
      {...props}
    />
  );
}

export function TabsTrigger({ className, ...props }: ComponentProps<typeof TabsPrimitive.Trigger>) {
  return (
    <TabsPrimitive.Trigger
      className={cn(
        'flex flex-1 items-center justify-center rounded-[9px] px-2 py-1.5 text-[13px] font-semibold text-text-muted transition-colors hover:text-text pointer-coarse:min-h-11',
        'data-[state=active]:bg-white/10 data-[state=active]:text-text data-[state=active]:shadow-[inset_0_1px_0_var(--highlight)]',
        className,
      )}
      {...props}
    />
  );
}

export function TabsContent({ className, ...props }: ComponentProps<typeof TabsPrimitive.Content>) {
  return <TabsPrimitive.Content className={cn('min-h-0 flex-1', className)} {...props} />;
}
