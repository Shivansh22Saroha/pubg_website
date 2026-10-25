import type { Metadata } from 'next';
import { RegisterForm } from '@/components/auth/RegisterForm';
import { safeRedirect } from '@/lib/redirect';

export const metadata: Metadata = { title: 'Create account' };

export default async function RegisterPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { redirectTo } = await searchParams;
  return <RegisterForm redirectTo={safeRedirect(redirectTo)} />;
}
