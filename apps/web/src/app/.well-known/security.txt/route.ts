import { securityTxt } from '@/lib/securityTxt';
import { serverEnv } from '@/lib/serverEnv';

export const dynamic = 'force-dynamic';

/** SECURITY §13: responsible-disclosure contact, from SECURITY_CONTACT. Unset → 404. */
export function GET(): Response {
  const contact = serverEnv().SECURITY_CONTACT;
  if (!contact) return new Response('Not found', { status: 404 });
  const origin = process.env.NEXT_PUBLIC_APP_ORIGIN ?? 'http://localhost:3000';
  return new Response(securityTxt(contact, origin), {
    headers: {
      'content-type': 'text/plain; charset=utf-8',
      'cache-control': 'public, max-age=86400',
    },
  });
}
