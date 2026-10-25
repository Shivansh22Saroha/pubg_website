'use client';

import { passwordRules, passwordStrength } from '@rotationlab/shared';
import { Check, X } from 'lucide-react';
import { cn } from '@/lib/utils';

const LABELS = ['Too weak', 'Weak', 'Fair', 'Good', 'Strong'] as const;
const COLORS = ['bg-danger', 'bg-danger', 'bg-warning', 'bg-success', 'bg-success'] as const;

/** Strength meter + rules list (UI_UX_SPEC §3.2). The breached-list check is server-side. */
export function PasswordStrength({ password }: { password: string }) {
  const score = passwordStrength(password);
  const rules = passwordRules(password);
  return (
    <div className="flex flex-col gap-2" aria-live="polite">
      <div className="flex items-center gap-2">
        <div className="flex flex-1 gap-1" aria-hidden>
          {[1, 2, 3, 4].map((i) => (
            <span
              key={i}
              className={cn(
                'h-1 flex-1 rounded-full bg-border',
                password && i <= score && COLORS[score],
              )}
            />
          ))}
        </div>
        <span className="w-16 text-right text-xs text-text-muted">
          {password ? LABELS[score] : ''}
        </span>
      </div>
      <ul className="flex flex-col gap-0.5 text-xs">
        {rules.map((r) => (
          <li
            key={r.id}
            className={cn('flex items-center gap-1.5', r.ok ? 'text-success' : 'text-text-muted')}
          >
            {r.ok ? <Check className="size-3" aria-hidden /> : <X className="size-3" aria-hidden />}
            {r.label}
          </li>
        ))}
        <li className="text-text-muted">Not a commonly breached password (checked on submit)</li>
      </ul>
    </div>
  );
}
