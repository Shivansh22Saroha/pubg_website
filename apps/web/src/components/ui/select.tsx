import type { ComponentProps } from 'react';
import { cn } from '@/lib/utils';

/** Native select styled like Input — accessible and fine for short option lists. */
export function NativeSelect({ className, ...props }: ComponentProps<'select'>) {
  return (
    <select
      className={cn(
        'h-10 w-full rounded-control border-2 bg-bg px-3 text-sm text-text focus-visible:border-accent disabled:opacity-50',
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
        'min-h-20 w-full rounded-control border bg-surface-2 px-3 py-2 text-sm text-text placeholder:text-text-muted focus-visible:border-accent',
        className,
      )}
      {...props}
    />
  );
}
