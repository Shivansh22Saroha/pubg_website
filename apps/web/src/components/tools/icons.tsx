import type { SVGProps } from 'react';

/**
 * RotationLab's own tool icons (UI_UX_SPEC §3.5): one 24 px grid, 2 px strokes, round caps —
 * the same weight as the lucide icons elsewhere, but drawn for what each tool does on a
 * tactical map (a route, a zone, a push arrow…) so no two tools look alike. Decorative only:
 * the button carries the accessible name.
 */
export type ToolIcon = (props: SVGProps<SVGSVGElement>) => React.JSX.Element;

function Svg({ children, ...props }: SVGProps<SVGSVGElement>) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
      focusable="false"
      {...props}
    >
      {children}
    </svg>
  );
}

/** Select: a cursor with a small move cross — select, then drag to move */
export const SelectIcon: ToolIcon = (p) => (
  <Svg {...p}>
    <path d="M4 3.5 10.5 19l2.2-6.3L19 10.5Z" fill="currentColor" fillOpacity={0.18} />
    <path d="M17 16v5M14.5 18.5h5" />
  </Svg>
);

/** Pen: a free route — a winding line from a start dot up to a pen nib */
export const PenIcon: ToolIcon = (p) => (
  <Svg {...p}>
    <circle cx={4} cy={19.5} r={1.8} fill="currentColor" stroke="none" />
    <path d="M5.5 18.5c3.5-.5 2.5-5 6-5.5 2.4-.4 3 1.6 4.6.2" />
    <path
      d="m15 10.6 4.6-4.6a1.6 1.6 0 0 0-2.3-2.3L12.7 8.3l-.7 3Z"
      fill="currentColor"
      fillOpacity={0.18}
    />
  </Svg>
);

/** Line: a straight segment between two end points */
export const LineIcon: ToolIcon = (p) => (
  <Svg {...p}>
    <path d="M6 18 18 6" />
    <circle cx={5} cy={19} r={2} />
    <circle cx={19} cy={5} r={2} />
  </Svg>
);

/** Arrow: a push / rotation — a curved shaft into a solid head */
export const ArrowIcon: ToolIcon = (p) => (
  <Svg {...p}>
    <path d="M4 19c1-6 5-10 11.5-11" />
    <path d="m13 4.5 6.5 3.2-4 5.8Z" fill="currentColor" />
  </Svg>
);

/** Circle: a zone — dashed ring with its centre */
export const ZoneIcon: ToolIcon = (p) => (
  <Svg {...p}>
    <circle cx={12} cy={12} r={8.5} strokeDasharray="3.2 2.6" />
    <circle cx={12} cy={12} r={1.8} fill="currentColor" stroke="none" />
    <path d="M12 12h6" strokeOpacity={0.55} />
  </Svg>
);

/** Polygon: an area — a filled shape with its corner points */
export const AreaIcon: ToolIcon = (p) => (
  <Svg {...p}>
    <path d="m5 8 7-4.5L19.5 9 17 19H7Z" fill="currentColor" fillOpacity={0.16} />
    <circle cx={5} cy={8} r={1.5} fill="currentColor" stroke="none" />
    <circle cx={12} cy={3.5} r={1.5} fill="currentColor" stroke="none" />
    <circle cx={19.5} cy={9} r={1.5} fill="currentColor" stroke="none" />
    <circle cx={17} cy={19} r={1.5} fill="currentColor" stroke="none" />
    <circle cx={7} cy={19} r={1.5} fill="currentColor" stroke="none" />
  </Svg>
);

/** Text: a T on a label tag */
export const TextIcon: ToolIcon = (p) => (
  <Svg {...p}>
    <path d="M5 6.5V5h14v1.5M12 5v13M9 18h6" />
  </Svg>
);

/** Marker: a map pin with a crosshair dot */
export const MarkerIcon: ToolIcon = (p) => (
  <Svg {...p}>
    <path d="M12 21s-6.5-5.6-6.5-11a6.5 6.5 0 0 1 13 0c0 5.4-6.5 11-6.5 11Z" />
    <circle cx={12} cy={10} r={2.2} fill="currentColor" stroke="none" />
  </Svg>
);

/** Eraser: a tilted eraser block wiping a line */
export const EraserIcon: ToolIcon = (p) => (
  <Svg {...p}>
    <path d="m14.5 4.5 5 5-8.8 8.8H6.2l-2.7-2.7a1.5 1.5 0 0 1 0-2.1Z" />
    <path d="m9.5 9.5 5 5" />
    <path d="M13 19.5h7" strokeOpacity={0.55} />
  </Svg>
);

/** Measure: a ruler with ticks and a distance arrow */
export const MeasureIcon: ToolIcon = (p) => (
  <Svg {...p}>
    <rect x={2.5} y={8.5} width={19} height={7} rx={1.5} transform="rotate(-35 12 12)" />
    <path d="m8.2 11.9 1.4 2M11.1 9.9l1.4 2M14 7.9l1.4 2" />
  </Svg>
);

/** Laser: a bright point with a fading trail — point at something for the squad */
export const LaserIcon: ToolIcon = (p) => (
  <Svg {...p}>
    <path d="M3.5 20c3-1 5.5-3 7.5-6" strokeOpacity={0.35} />
    <path d="M8 18.5c2-1.2 3.6-2.8 5-5" strokeOpacity={0.6} />
    <circle cx={15.5} cy={8.5} r={2.6} fill="currentColor" stroke="none" />
    <path d="M15.5 2.5v1.5M21.5 8.5H20M19.7 4.3l-1 1M19.7 12.7l-1-1M11.3 4.3l1 1" />
  </Svg>
);

/** Style bar: dashed stroke */
export const DashedIcon: ToolIcon = (p) => (
  <Svg {...p}>
    <path d="M3 12h4M10 12h4M17 12h4" />
  </Svg>
);

/** Style bar: an arrow with heads at both ends */
export const DoubleHeadIcon: ToolIcon = (p) => (
  <Svg {...p}>
    <path d="M5 12h14" />
    <path d="m7.5 8.5-4 3.5 4 3.5M16.5 8.5l4 3.5-4 3.5" />
  </Svg>
);

/** Style bar: a curved arrow through its bends */
export const CurvedIcon: ToolIcon = (p) => (
  <Svg {...p}>
    <path d="M3.5 17c3-8 7.5-8 10-4s5 2 6-3" />
    <path d="m17 9.5 2.6.4.4-2.6" />
  </Svg>
);

/** Map HUD: place-name labels on the map — a pin with a name tag */
export const MapLabelsIcon: ToolIcon = (p) => (
  <Svg {...p}>
    <path d="M7 20s-4-3.4-4-6.8a4 4 0 0 1 8 0C11 16.6 7 20 7 20Z" />
    <circle cx={7} cy={13.2} r={1.2} fill="currentColor" stroke="none" />
    <rect x={12.5} y={4} width={9} height={6} rx={1.5} />
    <path d="M14.8 7h4.4" />
  </Svg>
);
