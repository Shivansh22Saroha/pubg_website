import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * The shared Tailwind utilities that map chrome relies on. The BGMI theme pass once deleted
 * `glass` by accident and every floating panel went see-through — keep them defined.
 */
describe('globals.css custom utilities', () => {
  const css = readFileSync(join(__dirname, '../src/app/globals.css'), 'utf8');
  it.each(['glass', 'surface-raised', 'app-backdrop', 'bgmi-cut', 'bgmi-halftone', 'bgmi-dots'])(
    '@utility %s is defined',
    (name) => {
      expect(css).toMatch(new RegExp(`@utility ${name} \\{`));
    },
  );
});
