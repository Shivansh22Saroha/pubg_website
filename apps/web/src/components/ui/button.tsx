import { cva, type VariantProps } from 'class-variance-authority';
import type { ComponentProps } from 'react';
import { cn } from '@/lib/utils';

const buttonVariants = cva(
  'inline-flex shrink-0 items-center justify-center gap-2 rounded-control text-[13px] font-semibold whitespace-nowrap transition-colors duration-150 ease-hud disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:shrink-0',
  {
    variants: {
      variant: {
        // Phase 13: filled buttons are blocks — a dark edge and a hard offset shadow they sink into
        accent:
          'press border-2 border-bg bg-accent text-accent-fg shadow-[var(--shadow-accent)] hover:shadow-[var(--shadow-accent-lg)]',
        outline:
          'press border-2 border-accent bg-bg text-accent shadow-[var(--shadow-hard-sm)] hover:bg-accent/10',
        ghost: 'text-text hover:bg-surface-2',
        destructive:
          'press border-2 border-bg bg-danger-strong text-white shadow-[var(--shadow-danger)] hover:bg-danger-strong/90',
      },
      size: {
        // touch: ≥ 44 px targets (UI_UX_SPEC §7)
        sm: 'h-8 px-3 pointer-coarse:h-11',
        md: 'h-9 px-4 pointer-coarse:h-11',
        icon: 'size-10 pointer-coarse:size-11',
      },
    },
    defaultVariants: { variant: 'accent', size: 'md' },
  },
);

export type ButtonProps = ComponentProps<'button'> & VariantProps<typeof buttonVariants>;

export function Button({ className, variant, size, type = 'button', ...props }: ButtonProps) {
  return (
    <button type={type} className={cn(buttonVariants({ variant, size }), className)} {...props} />
  );
}

export { buttonVariants };
