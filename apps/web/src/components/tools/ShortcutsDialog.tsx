'use client';

import { Dialog, DialogContent } from '@/components/ui/dialog';
import { isMacPlatform, shortcutHelp } from '@/lib/shortcuts';

/** `?` — every shortcut (UI_UX_SPEC §8). Shortcuts are off while it is open. */
export function ShortcutsDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const groups = shortcutHelp(isMacPlatform());
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      {open && (
        <DialogContent
          title="Keyboard shortcuts"
          description="Shortcuts are off while you type in a field."
          className="max-w-4xl"
        >
          <div className="grid gap-6 sm:grid-cols-[1fr_1.7fr_1.3fr]">
            {groups.map((g) => (
              <section key={g.group} aria-label={g.group}>
                <h3 className="mb-2 text-xs font-semibold tracking-wide text-text-muted uppercase">
                  {g.group}
                </h3>
                <dl className="flex flex-col gap-1.5 text-sm">
                  {g.items.map(([keys, action]) => (
                    <div key={keys} className="flex items-baseline justify-between gap-3">
                      <dt className="min-w-0 text-text-muted">{action}</dt>
                      <dd className="shrink-0">
                        <kbd className="rounded border bg-bg px-1.5 py-0.5 font-mono text-xs whitespace-nowrap">
                          {keys}
                        </kbd>
                      </dd>
                    </div>
                  ))}
                </dl>
              </section>
            ))}
          </div>
        </DialogContent>
      )}
    </Dialog>
  );
}
