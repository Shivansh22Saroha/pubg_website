import type { ReactNode } from 'react';

/** Shared bits of the placeholder legal pages. */
export function LegalNotice() {
  // TODO(phase0): replace with reviewed text — Privacy and Terms need a legal review before launch.
  return (
    <p
      role="note"
      className="mb-8 rounded-panel border border-warning/60 bg-warning/10 px-4 py-3 text-sm"
    >
      Draft placeholder — this text describes what the app actually does today, but it has not been
      reviewed by a lawyer yet.
    </p>
  );
}

export function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="mt-8">
      <h2 className="font-display text-xl font-bold">{title}</h2>
      <div className="mt-2 space-y-2 text-sm leading-relaxed text-text-muted [&_strong]:text-text">
        {children}
      </div>
    </section>
  );
}
