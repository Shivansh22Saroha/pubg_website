import type { ComponentProps } from 'react';
import { cn } from '@/lib/utils';

export function Input({ className, ...props }: ComponentProps<'input'>) {
  return (
    <input
      className={cn(
        'h-10 w-full rounded-control border-2 bg-bg px-3 text-sm text-text placeholder:text-text-muted',
        'transition-[border-color,box-shadow] duration-150 ease-hud focus-visible:border-accent focus-visible:shadow-[var(--shadow-accent)]',
        'aria-[invalid=true]:border-danger disabled:opacity-50',
        className,
      )}
      {...props}
    />
  );
}

export function Label({ className, ...props }: ComponentProps<'label'>) {
  return <label className={cn('text-[13px] font-medium text-text', className)} {...props} />;
}

export function FieldError({ id, children }: { id: string; children?: string | undefined }) {
  if (!children) return null;
  return (
    <p id={id} role="alert" className="text-xs text-danger">
      {children}
    </p>
  );
}
