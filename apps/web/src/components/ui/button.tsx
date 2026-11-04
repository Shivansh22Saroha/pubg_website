import { cva, type VariantProps } from 'class-variance-authority';
import type { ComponentProps } from 'react';
import { cn } from '@/lib/utils';

const buttonVariants = cva(
  'inline-flex shrink-0 items-center justify-center gap-2 rounded-control text-[13px] font-semibold tracking-[0.01em] whitespace-nowrap transition-[color,background-color,border-color,box-shadow,filter] duration-150 ease-hud disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:shrink-0',
  {
    variants: {
      variant: {
        accent:
          'bg-[linear-gradient(180deg,var(--accent-hi),var(--accent))] text-accent-fg shadow-[inset_0_1px_0_rgba(255,255,255,0.4),0_1px_2px_rgba(0,0,0,0.5),0_6px_18px_-8px_var(--accent-glow)] hover:brightness-[1.06] active:brightness-95 disabled:bg-none disabled:bg-surface-3 disabled:text-text-muted disabled:opacity-100 disabled:shadow-[inset_0_1px_0_var(--highlight)]',
        outline:
          'border border-accent/50 bg-accent/[0.04] text-accent hover:border-accent hover:bg-accent/10',
        ghost: 'text-text hover:bg-surface-2 hover:shadow-[inset_0_1px_0_var(--highlight)]',
        destructive: 'bg-danger-strong text-white hover:bg-danger-strong/90',
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
