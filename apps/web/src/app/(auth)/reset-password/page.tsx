import type { Metadata } from 'next';
import { ResetPassword } from '@/components/auth/EmailFlows';

// the token is in the URL: never send it on as a Referer
export const metadata: Metadata = { title: 'Reset password', referrer: 'no-referrer' };

export default function Page() {
  return <ResetPassword />;
}
