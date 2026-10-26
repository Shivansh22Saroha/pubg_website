import type { Metadata } from 'next';
import { VerifyEmail } from '@/components/auth/EmailFlows';

// the token is in the URL: never send it on as a Referer
export const metadata: Metadata = { title: 'Verify email', referrer: 'no-referrer' };

export default function Page() {
  return <VerifyEmail />;
}
