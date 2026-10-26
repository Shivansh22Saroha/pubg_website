import { distanceMetres, formatMetres, travelTimeSeconds, type Pt } from './coords.js';

/** Measure tool maths (FEATURES F11, STUDY-1). No elevation: there is no height data. */
export interface MeasureSummary {
  /** each segment's length, metres */
  segments: number[];
  total: number;
  /** whole minutes, ≥ 1 once there is any distance */
  footMin: number;
  vehicleMin: number;
}

const minutes = (seconds: number) => (seconds <= 0 ? 0 : Math.max(1, Math.round(seconds / 60)));

export function measure(points: readonly Pt[]): MeasureSummary {
  const segments: number[] = [];
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1];
    const b = points[i];
    if (a && b) segments.push(distanceMetres(a, b));
  }
  const total = segments.reduce((s, m) => s + m, 0);
  return {
    segments,
    total,
    footMin: minutes(travelTimeSeconds(total, 'foot')),
    vehicleMin: minutes(travelTimeSeconds(total, 'vehicle')),
  };
}

/** `3 420 m · ~10 min on foot · ~3 min by vehicle (approx.)` — always labelled approximate. */
export function formatMeasure(s: MeasureSummary): string {
  return `${formatMetres(s.total)} · ~${s.footMin} min on foot · ~${s.vehicleMin} min by vehicle (approx.)`;
}
