import { cn } from '@/lib/utils';

/** Spotter's glyph: binocular lenses over a range tick — a squad's spotter, not a robot face. */
export function SpotterIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" aria-hidden className={cn('size-5', className)} fill="none">
      <circle cx="7" cy="14" r="4.25" stroke="currentColor" strokeWidth="2.2" />
      <circle cx="17" cy="14" r="4.25" stroke="currentColor" strokeWidth="2.2" />
      <path
        d="M11 13.5h2M5.5 9.5 7.5 5h2l.8 3M18.5 9.5 16.5 5h-2l-.8 3"
        stroke="currentColor"
        strokeWidth="2.2"
        strokeLinejoin="round"
        strokeLinecap="round"
      />
    </svg>
  );
}
