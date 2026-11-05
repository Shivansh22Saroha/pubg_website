import Image from 'next/image';

/**
 * Landing hero art: a 1920×1080 crop of Erangel (no-text art, `public/landing/hero-erangel.webp`)
 * with the real 1.02 km grid and a squad plan drawn over it — drop on Pochinki, rotation north
 * past School, into the zone. The SVG shares the image's box and uses `slice`, the same scaling
 * as `object-cover`, so the drawing stays on the right streets at every viewport size.
 *
 * Crop: source x 410–6144, y 1638–4863 of the 8192 px art (scale 0.3349). A grid square is
 * 1024 source px = 342.9 px here; the first vertical line (B) is at x 205.6, the first
 * horizontal line (K) at y 137.3. Pure SVG, no client JS; the one animation is CSS
 * (`.rl-route` / `.rl-pop` in globals.css) and stops for prefers-reduced-motion.
 */
const SQ = 342.9;
const X0 = 205.6;
const Y0 = 137.3;
const COLS = ['B', 'C', 'D', 'E', 'F'];
const ROWS = ['K', 'L', 'M'];

const ROUTE = 'M1086 826 C 1060 720, 1000 640, 1012 548 S 1150 470, 1300 530';
const ROUTE_LEN = 640;

export function HeroMap() {
  return (
    <div aria-hidden className="absolute inset-0 overflow-hidden">
      <Image
        src="/landing/hero-erangel.webp"
        alt=""
        fill
        priority
        unoptimized // pre-optimised WebP (1920×1080, ~300 KB)
        sizes="100vw"
        className="object-cover object-center opacity-90 saturate-[0.85]"
      />
      {/* legibility: dark from the left (where the headline sits) and into the page below */}
      <div className="absolute inset-0 bg-[linear-gradient(90deg,var(--bg)_0%,rgba(9,12,17,0.92)_30%,rgba(9,12,17,0.45)_58%,rgba(9,12,17,0.1)_100%)] max-md:bg-[linear-gradient(180deg,rgba(9,12,17,0.55)_0%,rgba(9,12,17,0.82)_55%,var(--bg)_100%)]" />
      <div className="absolute inset-x-0 bottom-0 h-40 bg-[linear-gradient(180deg,transparent,var(--bg))]" />
      <svg
        viewBox="0 0 1920 1080"
        preserveAspectRatio="xMidYMid slice"
        className="absolute inset-0 size-full max-md:opacity-35"
      >
        <g stroke="rgba(255,255,255,0.16)" strokeWidth="1">
          {Array.from({ length: 5 }, (_, i) => (
            <line key={`v${i}`} x1={X0 + i * SQ} y1="0" x2={X0 + i * SQ} y2="1080" />
          ))}
          {Array.from({ length: 3 }, (_, i) => (
            <line key={`h${i}`} x1="0" y1={Y0 + i * SQ} x2="1920" y2={Y0 + i * SQ} />
          ))}
        </g>
        <g
          fill="rgba(232,237,242,0.55)"
          fontFamily="var(--font-display)"
          fontWeight="700"
          fontSize="22"
          textAnchor="middle"
        >
          {COLS.map((c, i) => (
            <text key={c} x={X0 + i * SQ + SQ / 2} y={Y0 - 16}>
              {c}
            </text>
          ))}
          {ROWS.map((r, i) => (
            <text key={r} x="1888" y={Y0 + i * SQ + SQ / 2 + 8}>
              {r}
            </text>
          ))}
        </g>

        {/* the zone the squad is rotating into */}
        <circle
          className="rl-pop"
          style={{ animationDelay: '1.7s' }}
          cx="1318"
          cy="540"
          r="150"
          fill="rgba(248,250,252,0.06)"
          stroke="#f8fafc"
          strokeWidth="2.5"
          strokeDasharray="10 9"
        />
        {/* rotation path */}
        <path
          d={ROUTE}
          fill="none"
          stroke="rgba(0,0,0,0.55)"
          strokeWidth="9"
          strokeLinecap="round"
          className="rl-route"
          style={{ ['--len' as string]: ROUTE_LEN }}
        />
        <path
          d={ROUTE}
          fill="none"
          stroke="#f5b301"
          strokeWidth="5"
          strokeLinecap="round"
          className="rl-route"
          style={{ ['--len' as string]: ROUTE_LEN }}
        />
        {/* drop marker on Pochinki */}
        <g className="rl-pop" style={{ animationDelay: '0.25s' }}>
          <circle cx="1086" cy="826" r="15" fill="#f5b301" stroke="#111" strokeWidth="3" />
          <circle cx="1086" cy="826" r="5" fill="#111" />
        </g>
        {/* own squad, arriving */}
        <g className="rl-pop" style={{ animationDelay: '2.05s' }}>
          <path
            d="M1300 504 l20 7 v16 c0 12 -9 20 -20 25 c-11 -5 -20 -13 -20 -25 v-16 z"
            fill="#38bdf8"
            stroke="#0b0f14"
            strokeWidth="3"
          />
        </g>
        {/* enemy squads called around the zone */}
        {[
          [1205, 410, 4, '2.2s'],
          [1478, 612, 11, '2.35s'],
          [1180, 676, 17, '2.5s'],
        ].map(([x, y, n, d]) => (
          <g key={n} className="rl-pop" style={{ animationDelay: d as string }}>
            <rect
              x={(x as number) - 13}
              y={(y as number) - 13}
              width="26"
              height="26"
              rx="3"
              transform={`rotate(45 ${x} ${y})`}
              fill="#ef4444"
              stroke="#0b0f14"
              strokeWidth="3"
            />
            <text
              x={x}
              y={(y as number) + 5}
              textAnchor="middle"
              fill="#fff"
              fontSize="14"
              fontWeight="700"
              fontFamily="var(--font-sans)"
            >
              {n}
            </text>
          </g>
        ))}
      </svg>
    </div>
  );
}
