'use client';

import { InviteCodeSchema } from '@rotationlab/shared';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { FieldError, Input } from '@/components/ui/input';

/** Dashboard "Join with code" (UF-5 alternate). */
export function JoinWithCode() {
  const router = useRouter();
  const [value, setValue] = useState('');
  const [error, setError] = useState<string>();

  return (
    <form
      className="flex flex-col gap-1.5"
      onSubmit={(e) => {
        e.preventDefault();
        const parsed = InviteCodeSchema.safeParse(value);
        if (!parsed.success) {
          setError('Codes look like 7KQ2-M9XF-AP');
          return;
        }
        router.push(`/join/${parsed.data}`);
      }}
    >
      <label htmlFor="join-code" className="section-label text-xs text-text-muted">
        Have an invite code?
      </label>
      <div className="flex gap-2">
        <Input
          id="join-code"
          placeholder="7KQ2-M9XF-AP"
          autoComplete="off"
          spellCheck={false}
          className="font-mono uppercase"
          value={value}
          aria-invalid={error ? true : undefined}
          aria-describedby="join-code-error"
          onChange={(e) => {
            setValue(e.target.value);
            setError(undefined);
          }}
        />
        <Button type="submit" variant="outline" className="h-10">
          Join
        </Button>
      </div>
      <FieldError id="join-code-error">{error}</FieldError>
    </form>
  );
}
