import type { Metadata } from 'next';
import { LoginForm } from '@/components/auth/LoginForm';
import { safeRedirect } from '@/lib/redirect';

export const metadata: Metadata = { title: 'Log in' };

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { redirectTo, error } = await searchParams;
  return (
    <LoginForm
      redirectTo={safeRedirect(redirectTo)}
      error={typeof error === 'string' ? error : undefined}
    />
  );
}
