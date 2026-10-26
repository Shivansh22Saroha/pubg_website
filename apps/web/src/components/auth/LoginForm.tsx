'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { LoginBodySchema, UserResponseSchema, type LoginBody } from '@rotationlab/shared';
import { useQueryClient } from '@tanstack/react-query';
import { Eye, EyeOff, Loader2 } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { useForm } from 'react-hook-form';
import { Button } from '@/components/ui/button';
import { FieldError, Input, Label } from '@/components/ui/input';
import { ME_QUERY_KEY } from '@/hooks/useMe';
import { api, refreshSession } from '@/lib/api';
import { ForgotLink } from './EmailFlows';
import { applyApiError } from './formErrors';

export function LoginForm({ redirectTo }: { redirectTo: string }) {
  const router = useRouter();
  const queryClient = useQueryClient();
  const [showPassword, setShowPassword] = useState(false);
  const [restoring, setRestoring] = useState(true);

  // A live session may only be missing its 15-min access cookie — try a silent refresh first.
  useEffect(() => {
    let cancelled = false;
    void refreshSession().then((ok) => {
      if (cancelled) return;
      if (ok) router.replace(redirectTo);
      else setRestoring(false);
    });
    return () => {
      cancelled = true;
    };
  }, [redirectTo, router]);

  const {
    register,
    handleSubmit,
    setError,
    formState: { errors, isSubmitting },
  } = useForm<LoginBody>({
    resolver: zodResolver(LoginBodySchema),
    defaultValues: { identifier: '', password: '' },
  });

  const onSubmit = handleSubmit(async (values) => {
    try {
      const { user } = await api('/auth/login', {
        method: 'POST',
        body: values,
        schema: UserResponseSchema,
      });
      queryClient.setQueryData(ME_QUERY_KEY, user);
      router.replace(redirectTo);
    } catch (err) {
      applyApiError(err, setError, ['identifier', 'password']);
    }
  });

  if (restoring) {
    return (
      <p className="flex items-center justify-center gap-2 py-8 text-text-muted" role="status">
        <Loader2 className="size-4 animate-spin" aria-hidden /> Checking your session…
      </p>
    );
  }

  return (
    <form onSubmit={(e) => void onSubmit(e)} noValidate className="flex flex-col gap-4">
      <h1 className="font-display text-2xl font-bold">Log in</h1>

      <div className="flex flex-col gap-1.5">
        <Label htmlFor="identifier">Email or username</Label>
        <Input
          id="identifier"
          autoComplete="username"
          autoFocus
          aria-invalid={errors.identifier ? true : undefined}
          aria-describedby="identifier-error"
          {...register('identifier')}
        />
        <FieldError id="identifier-error">{errors.identifier?.message}</FieldError>
      </div>

      <div className="flex flex-col gap-1.5">
        <div className="flex items-center justify-between">
          <Label htmlFor="password">Password</Label>
          {/* AUTH-7: only when the server has email set up */}
          <ForgotLink />
        </div>
        <div className="relative">
          <Input
            id="password"
            type={showPassword ? 'text' : 'password'}
            autoComplete="current-password"
            className="pr-10"
            aria-invalid={errors.password ? true : undefined}
            aria-describedby="password-error"
            {...register('password')}
          />
          <button
            type="button"
            onClick={() => {
              setShowPassword((s) => !s);
            }}
            aria-label={showPassword ? 'Hide password' : 'Show password'}
            aria-pressed={showPassword}
            className="absolute inset-y-0 right-0 flex w-10 items-center justify-center text-text-muted hover:text-text"
          >
            {showPassword ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
          </button>
        </div>
        <FieldError id="password-error">{errors.password?.message}</FieldError>
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
        Log in
      </Button>

      <p className="text-center text-sm text-text-muted">
        New here?{' '}
        <Link
          href={`/register?redirectTo=${encodeURIComponent(redirectTo)}`}
          className="text-info hover:underline"
        >
          Create an account
        </Link>
      </p>
    </form>
  );
}
