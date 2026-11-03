import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * Every <form> declares method="post" (Phase 10, ZAP 10024): forms are server-rendered, and a
 * form submitted before hydration — Enter on a slow connection — would otherwise default to
 * GET and put its fields (passwords included) in the URL, i.e. in proxy logs and history.
 */
function tsxFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = path.join(dir, e.name);
    return e.isDirectory() ? tsxFiles(p) : p.endsWith('.tsx') ? [p] : [];
  });
}

describe('forms', () => {
  it('every <form> posts', () => {
    const offenders = tsxFiles(path.resolve(__dirname, '../src')).flatMap((file) =>
      [...readFileSync(file, 'utf8').matchAll(/<form\b[^>]*>/g)]
        .filter((m) => !/method="post"/.test(m[0]))
        .map(() => path.relative(process.cwd(), file)),
    );
    expect(offenders).toEqual([]);
  });
});
