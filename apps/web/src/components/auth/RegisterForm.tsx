'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import {
  EmailSchema,
  PasswordSchema,
  USERNAME_PATTERN,
  UserResponseSchema,
  UsernameAvailableResponseSchema,
  UsernameSchema,
} from '@rotationlab/shared';
import { useQueryClient } from '@tanstack/react-query';
import { Check, Loader2, X } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { useForm, useWatch } from 'react-hook-form';
import { z } from 'zod';
import { Button } from '@/components/ui/button';
import { FieldError, Input, Label } from '@/components/ui/input';
import { ME_QUERY_KEY } from '@/hooks/useMe';
import { api } from '@/lib/api';
import { applyApiError } from './formErrors';
import { PasswordStrength } from './PasswordStrength';

// The API body schema plus a client-only confirmation field.
const FormSchema = z
  .object({
    email: EmailSchema,
    username: UsernameSchema,
    password: PasswordSchema,
    confirm: z.string(),
  })
  .refine((v) => v.password === v.confirm, {
    path: ['confirm'],
    message: 'Passwords do not match',
  });
type FormInput = z.input<typeof FormSchema>;
type FormOutput = z.output<typeof FormSchema>;

type Availability = 'idle' | 'checking' | 'available' | 'taken';

/** Debounced (400 ms) username availability check (UI_UX_SPEC §3.2). */
function useUsernameAvailability(raw: string): Availability {
  // each result remembers which name it belongs to, so a stale answer is never shown
  const [result, setResult] = useState<{ for: string; value: Availability }>({
    for: '',
    value: 'idle',
  });
  const username = raw.trim().toLowerCase();
  const valid = USERNAME_PATTERN.test(username);

  useEffect(() => {
    if (!valid) return;
    const controller = new AbortController();
    const timer = setTimeout(() => {
      setResult({ for: username, value: 'checking' });
      api(`/auth/username-available?u=${encodeURIComponent(username)}`, {
        schema: UsernameAvailableResponseSchema,
        signal: controller.signal,
      })
        .then((r) => {
          setResult({ for: username, value: r.available ? 'available' : 'taken' });
        })
        .catch(() => {
          // rate-limited / offline: the server re-checks on submit anyway
          setResult({ for: username, value: 'idle' });
        });
    }, 400);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [username, valid]);

  return valid && result.for === username ? result.value : 'idle';
}

export function RegisterForm({ redirectTo }: { redirectTo: string }) {
  const router = useRouter();
  const queryClient = useQueryClient();
  const {
    register,
    handleSubmit,
    setError,
    control,
    formState: { errors, isSubmitting },
  } = useForm<FormInput, unknown, FormOutput>({
    resolver: zodResolver(FormSchema),
    defaultValues: { email: '', username: '', password: '', confirm: '' },
  });
  const [username, password] = useWatch({ control, name: ['username', 'password'] });
  const availability = useUsernameAvailability(username);

  const onSubmit = handleSubmit(async ({ confirm: _confirm, ...body }) => {
    try {
      const { user } = await api('/auth/register', {
        method: 'POST',
        body,
        schema: UserResponseSchema,
      });
      queryClient.setQueryData(ME_QUERY_KEY, user);
      router.replace(redirectTo);
    } catch (err) {
      applyApiError(err, setError, ['email', 'username', 'password']);
    }
  });

  const field = (name: keyof FormInput) => ({
    'aria-invalid': errors[name] ? true : undefined,
    'aria-describedby': `${name}-error`,
  });

  return (
    <form onSubmit={(e) => void onSubmit(e)} noValidate className="flex flex-col gap-4">
      <h1 className="font-display text-2xl font-bold">Create your account</h1>

      <div className="flex flex-col gap-1.5">
        <Label htmlFor="email">Email</Label>
        <Input
          id="email"
          type="email"
          autoComplete="email"
          autoFocus
          {...field('email')}
          {...register('email')}
        />
        <FieldError id="email-error">{errors.email?.message}</FieldError>
      </div>

      <div className="flex flex-col gap-1.5">
        <Label htmlFor="username">Username</Label>
        <div className="relative">
          <Input
            id="username"
            autoComplete="username"
            spellCheck={false}
            className="pr-24"
            {...field('username')}
            {...register('username')}
          />
          <span
            data-testid="username-availability"
            className="pointer-events-none absolute inset-y-0 right-3 flex items-center gap-1 text-xs"
            aria-live="polite"
          >
            {availability === 'checking' && (
              <Loader2 className="size-3 animate-spin text-text-muted" />
            )}
            {availability === 'available' && (
              <span className="flex items-center gap-1 text-success">
                <Check className="size-3" aria-hidden /> available
              </span>
            )}
            {availability === 'taken' && (
              <span className="flex items-center gap-1 text-danger">
                <X className="size-3" aria-hidden /> taken
              </span>
            )}
          </span>
        </div>
        <FieldError id="username-error">{errors.username?.message}</FieldError>
      </div>

      <div className="flex flex-col gap-1.5">
        <Label htmlFor="password">Password</Label>
        <Input
          id="password"
          type="password"
          autoComplete="new-password"
          {...field('password')}
          {...register('password')}
        />
        <PasswordStrength password={password} />
        <FieldError id="password-error">{errors.password?.message}</FieldError>
      </div>

      <div className="flex flex-col gap-1.5">
        <Label htmlFor="confirm">Confirm password</Label>
        <Input
          id="confirm"
          type="password"
          autoComplete="new-password"
          {...field('confirm')}
          {...register('confirm')}
        />
        <FieldError id="confirm-error">{errors.confirm?.message}</FieldError>
      </div>

      {errors.root?.message && (
        <p
          role="alert"
          data-testid="form-error"
          className="rounded-control border border-danger/40 bg-danger/10 px-3 py-2 text-sm text-danger"
        >
          {errors.root.message}
        </p>
      )}

      <Button type="submit" disabled={isSubmitting} className="h-10">
        {isSubmitting && <Loader2 className="size-4 animate-spin" aria-hidden />}
        Create account
      </Button>

      <p className="text-center text-sm text-text-muted">
        Already have an account?{' '}
        <Link
          href={`/login?redirectTo=${encodeURIComponent(redirectTo)}`}
          className="text-info underline underline-offset-2 hover:no-underline"
        >
          Log in
        </Link>
      </p>
    </form>
  );
}
