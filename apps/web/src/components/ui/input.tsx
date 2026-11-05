import type { ComponentProps } from 'react';
import { cn } from '@/lib/utils';

export function Input({ className, ...props }: ComponentProps<'input'>) {
  return (
    <input
      className={cn(
        'h-10 w-full rounded-control border bg-bg/70 px-3 text-sm text-text shadow-[inset_0_1px_2px_rgba(0,0,0,0.35)] placeholder:text-text-muted/80',
        'transition-[border-color,box-shadow] duration-150 ease-hud hover:border-border-strong focus-visible:border-accent focus-visible:shadow-[0_0_0_3px_var(--accent-glow)] focus-visible:outline-none',
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
