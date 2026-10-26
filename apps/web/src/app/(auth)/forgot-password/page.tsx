import type { Metadata } from 'next';
import { ForgotPassword } from '@/components/auth/EmailFlows';

// the token is in the URL: never send it on as a Referer
export const metadata: Metadata = { title: 'Forgot password', referrer: 'no-referrer' };

export default function Page() {
  return <ForgotPassword />;
}
