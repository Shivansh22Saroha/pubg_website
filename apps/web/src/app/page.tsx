import { PRODUCT_NAME } from '@rotationlab/shared';
import type { Metadata } from 'next';
import Image from 'next/image';
import Link from 'next/link';
import { CreateRoomCta } from '@/components/site/NavAuth';
import { SiteFooter, SiteHeader } from '@/components/site/SiteChrome';
import { buttonVariants } from '@/components/ui/button';

export const metadata: Metadata = {
  title: { absolute: `${PRODUCT_NAME} — plan your rotations together` },
};

/**
 * Feature cards (UI_UX_SPEC §3.1). Static WebP screenshots of a seeded demo board, made by
 * `pnpm --filter web shots` (scripts/landing-shots.ts) — no video, no map code on this page.
 */
const FEATURES = [
  {
    title: 'Live drawing',
    body: 'Arrows, zones and enemy markers appear for the whole squad as you draw — with cursors, undo and layers.',
    image: '/landing/live-drawing.webp',
    alt: 'A board on Erangel with a drop marker, a rotation arrow, a zone circle and enemy squad markers',
  },
  {
    title: 'Map pings in chat',
    body: 'Drop a ping into the chat; a click flies everyone to the exact spot on the right board.',
    image: '/landing/map-pings.webp',
    alt: 'The room chat with a map ping chip next to the board it points at',
  },
  {
    title: 'Erangel, Miramar, Rondo',
    body: 'Zoomable maps with a labelled grid, measure tool and travel-time estimates.',
    image: '/landing/maps.webp',
    alt: 'Miramar with the grid and a measured route showing distance and travel time',
  },
] as const;

export default function HomePage() {
  return (
    <div className="flex min-h-dvh flex-col">
      <SiteHeader />

      <main className="flex-1">
        <section aria-labelledby="hero" className="mx-auto max-w-6xl px-4 pt-16 pb-12 sm:pt-24">
          <p className="section-label mb-3 text-xs text-accent">For BGMI &amp; PUBG squads</p>
          <h1
            id="hero"
            className="max-w-2xl font-display text-4xl leading-tight font-bold sm:text-5xl"
          >
            Plan your rotations together.
          </h1>
          <p className="mt-4 max-w-xl text-base text-text-muted">
            One shared, live tactical map for your squad — drops, rotations and enemy calls on
            Erangel, Miramar and Rondo.
          </p>
          <div className="mt-8 flex flex-wrap gap-3">
            <CreateRoomCta className="h-11 px-5 text-sm" />
            <Link
              href="/explore"
              className={buttonVariants({ variant: 'outline', className: 'h-11 px-5 text-sm' })}
            >
              Explore maps
            </Link>
          </div>
        </section>

        <section aria-labelledby="features" className="mx-auto max-w-6xl px-4 pb-20">
          <h2 id="features" className="sr-only">
            Features
          </h2>
          <ul className="grid gap-6 md:grid-cols-3">
            {FEATURES.map((f) => (
              <li key={f.title} className="overflow-hidden rounded-panel border bg-surface">
                <Image
                  src={f.image}
                  alt={f.alt}
                  width={640}
                  height={400}
                  unoptimized // pre-optimised WebP
                  sizes="(min-width: 768px) 33vw, 100vw"
                  className="aspect-[8/5] w-full border-b bg-surface-2 object-cover"
                />
                <div className="p-4">
                  <h3 className="font-display text-lg font-semibold">{f.title}</h3>
                  <p className="mt-1 text-sm text-text-muted">{f.body}</p>
                </div>
              </li>
            ))}
          </ul>
        </section>
      </main>

      <SiteFooter />
    </div>
  );
}
