import type { Metadata } from 'next';
import { SharedBoardView } from '@/components/explore/SharedBoardView';
import { SiteHeader } from '@/components/site/SiteChrome';
import { Providers } from '../../providers';

export const metadata: Metadata = {
  title: 'Shared board',
  description: 'A read-only RotationLab board.',
  // the token is a credential: keep it out of search indexes and of Referer headers
  robots: { index: false, follow: false },
  referrer: 'no-referrer',
};

/** Phase 11 (FEATURES F4b): a board shared by link — read-only, no login, no socket. */
export default async function SharedBoardPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  return (
    <div className="flex h-dvh flex-col">
      <SiteHeader wide />
      <Providers>
        <SharedBoardView token={token} />
      </Providers>
    </div>
  );
}
