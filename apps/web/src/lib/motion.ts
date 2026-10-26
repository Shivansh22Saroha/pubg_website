/** UI_UX_SPEC §2.4: `prefers-reduced-motion` → no pulses, no glides, instant jumps. */
export function prefersReducedMotion(): boolean {
  return (
    typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches
  );
}
