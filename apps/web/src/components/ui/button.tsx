import { cva, type VariantProps } from 'class-variance-authority';
import type { ComponentProps } from 'react';
import { cn } from '@/lib/utils';

const buttonVariants = cva(
  'inline-flex shrink-0 items-center justify-center gap-2 rounded-control text-[13px] font-semibold tracking-[0.01em] whitespace-nowrap transition-[color,background-color,border-color,box-shadow,filter] duration-150 ease-hud disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:shrink-0',
  {
    variants: {
      variant: {
        // glass theme (UI_UX_SPEC §2.5): solid amber with a soft glow, rounded, normal case
        accent:
          'rounded-[11px] bg-accent text-accent-fg shadow-[0_8px_24px_-10px_var(--accent-glow),inset_0_1px_0_rgba(255,255,255,0.3)] hover:bg-accent-hi active:brightness-95 disabled:bg-surface-3 disabled:text-text-muted disabled:shadow-none disabled:opacity-100',
        // frosted glass with a light hairline
        outline:
          'rounded-[11px] border border-[var(--edge-strong)] bg-white/[0.04] text-text backdrop-blur-md hover:bg-white/[0.08] hover:border-white/25',
        ghost: 'rounded-[10px] text-text hover:bg-white/[0.06]',
        destructive: 'rounded-[11px] bg-danger-strong text-white hover:bg-danger-strong/90',
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
