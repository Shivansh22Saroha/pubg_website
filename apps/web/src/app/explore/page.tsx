import type { Metadata } from 'next';
import { ExploreView } from '@/components/explore/ExploreView';
import { SiteHeader } from '@/components/site/SiteChrome';
import { Providers } from '../providers';

export const metadata: Metadata = {
  title: 'Explore maps',
  description: 'Read-only demo boards on Erangel, Miramar and Rondo — no account needed.',
};

/** FEATURES F13 / UF-9: public, read-only demo boards. */
export default function ExplorePage() {
  return (
    <div className="flex h-dvh flex-col">
      <SiteHeader />
      <Providers>
        <ExploreView />
      </Providers>
    </div>
  );
}
