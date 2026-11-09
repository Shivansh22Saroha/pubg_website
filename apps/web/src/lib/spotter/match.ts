import { INTENTS, type Intent } from './knowledge';

/** words that carry no meaning for matching */
/** map names are strong signals: a question naming a map should get that map's answer */
const MAP_WORDS = new Set(['erangel', 'miramar', 'rondo']);

const STOP = new Set(
  'a an and are be can could do does for from get got how i in is it me my of on or our should so the then there this to us we what when where which why will with you your'.split(
    ' ',
  ),
);

/** common BGMI / chat spellings folded onto the keyword the knowledge base uses */
const SYNONYMS: Record<string, string> = {
  ranger: 'erangel',
  erengal: 'erangel',
  erangle: 'erangel',
  miramaar: 'miramar',
  mirmar: 'miramar',
  milbase: 'military',
  pochi: 'pochinki',
  circl: 'circle',
  ring: 'zone',
  bluezone: 'blue',
  rotat: 'rotation',
  rotate: 'rotation',
  rotating: 'rotation',
  rotations: 'rotation',
  rote: 'rotation',
  route: 'rotation',
  hotdrop: 'drop',
  landing: 'drop',
  land: 'drop',
  jump: 'drop',
  nade: 'grenade',
  nades: 'grenade',
  molly: 'molotov',
  smokes: 'smoke',
  frnd: 'friend',
  frnds: 'friend',
  friends: 'friend',
  teammates: 'teammate',
  invit: 'invite',
  pwd: 'password',
  pass: 'password',
  signup: 'sign',
  register: 'sign',
  mob: 'mobile',
  ipad: 'tablet',
  img: 'image',
  pic: 'picture',
  ss: 'screenshot',
  ctrl: 'shortcut',
  hotkeys: 'shortcut',
  tdm: 'fight',
  car: 'vehicle',
  cars: 'vehicle',
  gaadi: 'vehicle',
  armour: 'armor',
  meter: 'metre',
  meters: 'metre',
  metres: 'metre',
  km: 'distance',
};

/** a light stemmer: enough to fold plurals and -ing/-ed forms onto the keyword list */
function stem(w: string): string {
  if (w.length > 5 && w.endsWith('ing')) return w.slice(0, -3);
  if (w.length > 4 && w.endsWith('ed')) return w.slice(0, -2);
  if (w.length > 3 && w.endsWith('es') && !w.endsWith('ses')) return w.slice(0, -2);
  if (w.length > 3 && w.endsWith('s') && !w.endsWith('ss')) return w.slice(0, -1);
  return w;
}

export function normalise(text: string): string {
  return text
    .toLowerCase()
    .replace(/['’]/g, '')
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function words(text: string): string[] {
  const out: string[] = [];
  for (const raw of normalise(text).split(' ')) {
    if (!raw || STOP.has(raw)) continue;
    const w = SYNONYMS[raw] ?? raw;
    out.push(w, stem(w));
    const s = SYNONYMS[stem(raw)];
    if (s) out.push(s);
  }
  return out;
}

interface Indexed {
  intent: Intent;
  /** keyword (and its stem) → weight: the first two keywords are the intent's subject (2) */
  keys: Map<string, number>;
  phrases: string[];
}

const INDEX: Indexed[] = INTENTS.map((intent) => {
  const keys = new Map<string, number>();
  intent.keywords.forEach((k, i) => {
    const w = MAP_WORDS.has(k) ? 5 : i < 2 ? 2 : 1;
    for (const form of [k, stem(k)]) keys.set(form, Math.max(keys.get(form) ?? 0, w));
  });
  return { intent, keys, phrases: (intent.phrases ?? []).map(normalise) };
});

export interface MatchResult {
  intent: Intent | null;
  score: number;
}

/** below this, Spotter admits it doesn't know instead of guessing */
export const MIN_SCORE = 2;

/**
 * Best intent for a free-text question. Scoring: each distinct keyword hit adds its weight (map
 * names 5, an intent's two subject keywords 2, the rest 1), +4 per phrase found verbatim, and
 * small talk is halved in longer questions so "ok so how do I invite" still reaches the invite
 * answer.
 */
export function match(question: string): MatchResult {
  const ws = new Set(words(question));
  const norm = ` ${normalise(question)} `;
  if (ws.size === 0) return { intent: null, score: 0 };
  let best: MatchResult = { intent: null, score: 0 };
  for (const { intent, keys, phrases } of INDEX) {
    let score = 0;
    const hit = new Set<string>();
    for (const w of ws) {
      const weight = keys.get(w);
      if (weight && !hit.has(stem(w))) {
        hit.add(stem(w));
        score += weight;
      }
    }
    for (const p of phrases) if (norm.includes(` ${p} `)) score += 4;
    if (intent.topic === 'chat' && ws.size > 2) score *= 0.5;
    // ties go to the earlier (more general) intent, so equal is not better
    if (score > best.score) best = { intent, score };
  }
  // a lone greeting / thanks is fine at 1 hit; anything else needs real evidence
  const ok = best.intent?.topic === 'chat' ? best.score >= 1 : best.score >= MIN_SCORE;
  return ok ? best : { intent: null, score: best.score };
}
