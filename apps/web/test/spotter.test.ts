import { describe, expect, it } from 'vitest';
import { FALLBACK_SUGGESTIONS, INTENTS, STARTERS, byId } from '@/lib/spotter/knowledge';
import { match } from '@/lib/spotter/match';

describe('Spotter knowledge base', () => {
  it('has unique ids and every link / follow-up points somewhere real', () => {
    expect(byId.size).toBe(INTENTS.length);
    for (const i of INTENTS) {
      for (const n of i.next ?? []) expect(byId.has(n), `${i.id} → ${n}`).toBe(true);
      if (i.link) expect(i.link.href).toMatch(/^\/[a-z]/);
      // /maps/* is a dev-only page (404 in production)
      if (i.link) expect(i.link.href).not.toMatch(/^\/maps\//);
    }
    for (const id of [...STARTERS, ...FALLBACK_SUGGESTIONS]) expect(byId.has(id)).toBe(true);
  });

  it.each(INTENTS.map((i) => [i.question, i.id]))('chip "%s" answers %s', (q, id) => {
    expect(match(q).intent?.id).toBe(id);
  });
});

describe('match', () => {
  it.each([
    ['how do i add my friends to the room', 'invite'],
    ['where should we land on erangel', 'drop-erangel'],
    ['best hot drop in miramar?', 'drop-miramar'],
    ['rondo drop tips', 'drop-rondo'],
    ['when should we rotate', 'rotation-basics'],
    ['how to draw an arrow', 'draw-tools'],
    ['blue zone damage', 'zone-play'],
    ['how do i mark an enemy squad', 'markers'],
    ['how far is it from school to pochinki in minutes', 'measure'],
    ['download as png', 'export'],
    ['forgot password', 'account'],
    ['site is stuck loading', 'waking'],
    ['hello', 'hello'],
    ['thanks!', 'thanks'],
    ['how to cross the bridge to military base', 'bridges'],
    ['smokes', 'utility'],
    ['can viewers draw?', 'roles'],
    ['is there a demo', 'explore'],
    ['ok so how do i invite my squad', 'invite'],
  ])('"%s" → %s', (q, id) => {
    expect(match(q).intent?.id).toBe(id);
  });

  it('says it does not know instead of guessing', () => {
    expect(match('what is the capital of france').intent).toBeNull();
    expect(match('').intent).toBeNull();
    expect(match('???').intent).toBeNull();
  });
});
