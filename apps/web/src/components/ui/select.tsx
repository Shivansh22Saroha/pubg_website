import type { ComponentProps } from 'react';
import { cn } from '@/lib/utils';

/** Native select styled like Input — accessible and fine for short option lists. */
export function NativeSelect({ className, ...props }: ComponentProps<'select'>) {
  return (
    <select
      className={cn(
        'h-10 w-full rounded-control border bg-bg/70 px-3 text-sm text-text hover:border-border-strong focus-visible:border-accent focus-visible:shadow-[0_0_0_3px_var(--accent-glow)] focus-visible:outline-none disabled:opacity-50',
        className,
      )}
      {...props}
    />
  );
}

export function Textarea({ className, ...props }: ComponentProps<'textarea'>) {
  return (
    <textarea
      className={cn(
        'min-h-20 w-full rounded-control border bg-bg/70 px-3 py-2 text-sm text-text placeholder:text-text-muted/80 hover:border-border-strong focus-visible:border-accent focus-visible:shadow-[0_0_0_3px_var(--accent-glow)] focus-visible:outline-none',
        className,
      )}
      {...props}
    />
  );
}
