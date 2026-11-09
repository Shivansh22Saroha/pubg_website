import { PRODUCT_NAME } from '@rotationlab/shared';
import type { Metadata } from 'next';
import Image from 'next/image';
import Link from 'next/link';
import { HeroMap } from '@/components/site/HeroMap';
import { CreateRoomCta } from '@/components/site/NavAuth';
import { SiteFooter, SiteHeader } from '@/components/site/SiteChrome';
import { buttonVariants } from '@/components/ui/button';

export const metadata: Metadata = {
  title: { absolute: `${PRODUCT_NAME} — plan your rotations together` },
};

/**
 * Feature rows (UI_UX_SPEC §3.1). Static WebP screenshots of a seeded demo board, made by
 * `pnpm --filter web shots` (scripts/landing-shots.ts) — no video, no map code on this page.
 * Premium pass: alternating image/text rows instead of three identical cards; each row says
 * what the squad does with the feature.
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

/** What the hero drawing shows, in the board's own marker language. */
const LEGEND = [
  { label: 'Drop', swatch: 'size-3 rounded-full bg-accent ring-2 ring-black/80' },
  { label: 'Rotation', swatch: 'h-1 w-5 rounded-full bg-accent' },
  { label: 'Zone', swatch: 'size-3 rounded-full border-2 border-dashed border-white/90' },
  {
    label: 'Enemy squad',
    swatch: 'size-2.5 rotate-45 rounded-[2px] bg-danger ring-2 ring-black/80',
  },
] as const;

export default function HomePage() {
  return (
    <div className="flex min-h-dvh flex-col">
      <SiteHeader overlay />

      <main className="flex-1">
        <section
          aria-labelledby="hero"
          className="relative isolate -mt-16 flex min-h-[640px] items-center overflow-hidden pt-16 md:h-[min(92svh,880px)]"
        >
          <HeroMap />
          <div className="relative mx-auto flex w-full max-w-6xl flex-col items-center px-4 py-16 text-center md:py-0">
            {/* the lockup: a heavy white frame around the line, like a game title card */}
            <div className="w-fit max-w-full border-[6px] border-white bg-black/55 px-6 pt-5 pb-3 shadow-[0_30px_80px_-20px_rgba(0,0,0,0.9)] backdrop-blur-[2px] sm:border-8 sm:px-12">
              <h1
                id="hero"
                className="font-display text-[60px] leading-[0.82] font-bold tracking-[0.01em] sm:text-[96px] lg:text-[124px]"
              >
                <span className="block">Plan your </span>
                <span className="block">rotations </span>
                <span className="block">together.</span>
              </h1>
            </div>
            <p className="mt-7 max-w-lg text-[17px] leading-relaxed text-text/85">
              One shared, live tactical map for your squad — drops, rotations and enemy calls on
              Erangel, Miramar and Rondo.
            </p>
            <div className="mt-9 flex flex-wrap justify-center gap-3">
              <CreateRoomCta className="h-14 px-8 text-[26px]" />
              <Link
                href="/explore"
                className={buttonVariants({
                  variant: 'outline',
                  className: 'h-14 px-8 text-[26px]',
                })}
              >
                Explore maps
              </Link>
            </div>
            <ul
              aria-label="What the map shows"
              className="mt-12 flex flex-wrap justify-center gap-x-6 gap-y-2 font-display text-[19px] leading-none tracking-[0.03em] text-text/80 uppercase"
            >
              {LEGEND.map((l) => (
                <li key={l.label} className="flex items-center gap-2">
                  <span aria-hidden className={`inline-block shrink-0 ${l.swatch}`} />
                  <span className="pt-[3px]">{l.label}</span>
                </li>
              ))}
            </ul>
          </div>
        </section>

        <section aria-labelledby="features" className="mx-auto max-w-6xl px-4 pt-10 pb-24">
          <h2
            id="features"
            className="max-w-2xl font-display text-[44px] leading-[0.9] font-bold sm:text-[64px]"
          >
            Everything your squad says on comms, on one map.
          </h2>
          <ul className="mt-14 flex flex-col gap-20">
            {FEATURES.map((f, i) => (
              <li
                key={f.title}
                className={`grid items-center gap-8 md:gap-14 ${i % 2 ? 'md:grid-cols-[1fr_1.35fr]' : 'md:grid-cols-[1.35fr_1fr]'}`}
              >
                <div
                  className={`overflow-hidden border border-white/15 shadow-panel ${i % 2 ? 'md:order-2' : ''}`}
                >
                  <Image
                    src={f.image}
                    alt={f.alt}
                    width={960}
                    height={600}
                    unoptimized // pre-optimised WebP
                    sizes="(min-width: 768px) 58vw, 100vw"
                    className="aspect-[8/5] w-full bg-surface-2 object-cover"
                  />
                </div>
                <div className={i % 2 ? 'md:order-1' : ''}>
                  <h3 className="border-l-4 border-accent pl-3 font-display text-[34px] leading-[0.95] font-bold sm:text-[42px]">
                    <span className="block pt-[4px]">{f.title}</span>
                  </h3>
                  <p className="mt-3 max-w-sm text-[15px] leading-relaxed text-text-muted">
                    {f.body}
                  </p>
                </div>
              </li>
            ))}
          </ul>
        </section>

        <section aria-labelledby="cta" className="mx-auto w-full max-w-6xl px-4 pb-24">
          <div className="bgmi-dots relative overflow-hidden border border-white/15 bg-black px-6 py-12 sm:px-12">
            <div aria-hidden className="absolute inset-y-0 left-0 w-2 bg-accent" />
            <div className="relative flex flex-col gap-6 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <h2
                  id="cta"
                  className="font-display text-[44px] leading-[0.9] font-bold sm:text-[56px]"
                >
                  Next scrim, plan it here.
                </h2>
                <p className="mt-2 max-w-md text-[15px] text-text-muted">
                  Open a room, send the invite link to your squad and start drawing.
                </p>
              </div>
              <CreateRoomCta
                label="Open a room"
                className="h-14 self-start px-8 text-[26px] sm:self-auto"
              />
            </div>
          </div>
        </section>
      </main>

      <SiteFooter />
    </div>
  );
}
