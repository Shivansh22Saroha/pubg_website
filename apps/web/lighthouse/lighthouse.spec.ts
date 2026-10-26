import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { chromium, expect, test } from '@playwright/test';
import lighthouse from 'lighthouse';
import { pageApi, PASSWORD, uniqueName } from '../e2e/fixtures';

/**
 * Lighthouse (default mobile profile: simulated slow 4G + 4× CPU) on the landing page and the
 * dashboard. Targets (TESTING §7): Performance ≥ 85, Accessibility ≥ 95. Each page runs three
 * times and the median performance score counts (Lighthouse's own advice for variance).
 */
const PORT = 9333;
const RUNS = Number(process.env.LH_RUNS ?? 3);
const TARGET = { performance: 0.85, accessibility: 0.95 };

test('landing and dashboard meet the Lighthouse targets', async ({ baseURL }) => {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'rl-lh-'));
  // a persistent context is the browser's default one, so Lighthouse's tab shares its cookies
  const ctx = await chromium.launchPersistentContext(dir, {
    args: [`--remote-debugging-port=${PORT}`],
  });
  try {
    const page = ctx.pages()[0] ?? (await ctx.newPage());
    const name = uniqueName('lh');
    await page.goto(`${baseURL}/register`);
    await page.getByLabel('Email').fill(`${name}@example.com`);
    await page.getByLabel('Username').fill(name);
    await page.getByLabel('Password', { exact: true }).fill(PASSWORD);
    await page.getByLabel('Confirm password').fill(PASSWORD);
    await page.getByRole('button', { name: 'Create account' }).click();
    await page.waitForURL(/\/dashboard$/);
    // a dashboard with something on it
    for (const n of ['Scrims', 'Team Soul'])
      await pageApi(page, 'POST', '/rooms', {
        name: n,
        firstBoard: { name: 'Erangel – Plan 1', mapId: 'erangel' },
      });

    const results: Record<string, { performance: number[]; accessibility: number }> = {};
    for (const url of ['/', '/dashboard']) {
      const perf: number[] = [];
      let a11y = 0;
      for (let i = 0; i < RUNS; i++) {
        const run = await lighthouse(`${baseURL}${url}`, {
          port: PORT,
          output: 'json',
          logLevel: 'error',
          onlyCategories: ['performance', 'accessibility'],
          // the default reset clears the HTTP cache (cold loads) but never cookies, so the
          // /dashboard run stays logged in
        });
        if (!run) throw new Error('lighthouse returned nothing');
        const { categories, audits } = run.lhr;
        perf.push(categories.performance?.score ?? 0);
        a11y = categories.accessibility?.score ?? 0;
        if (i === 0) {
          mkdirSync(test.info().outputDir, { recursive: true });
          writeFileSync(
            path.join(test.info().outputDir, `lhr${url.replace(/\W+/g, '-')}.json`),
            JSON.stringify(run.lhr),
          );
          const { formFactor, throttlingMethod, throttling } = run.lhr.configSettings;
          console.log(
            `[lighthouse] ${url}: profile ${formFactor}, ${throttlingMethod} throttling (RTT ${throttling.rttMs} ms, ${throttling.throughputKbps} kbps, CPU ×${throttling.cpuSlowdownMultiplier})`,
          );
          // bundle size: what the page actually transfers (compressed), by resource type
          const summary = audits['resource-summary']?.details as
            | { items?: { resourceType: string; transferSize: number; requestCount: number }[] }
            | undefined;
          const kb = (type: string) => {
            const item = summary?.items?.find((x) => x.resourceType === type);
            return item
              ? `${(item.transferSize / 1024).toFixed(1)} KB / ${item.requestCount}`
              : '?';
          };
          console.log(
            `[lighthouse] ${url}: transfer — script ${kb('script')} · stylesheet ${kb('stylesheet')} · font ${kb('font')} · image ${kb('image')} · total ${kb('total')}`,
          );
          const lcpEl = audits['largest-contentful-paint-element']?.details as
            { items?: { items?: { node?: { snippet?: string } }[] }[] } | undefined;
          console.log(
            `[lighthouse] ${url}: LCP element ${lcpEl?.items?.[0]?.items?.[0]?.node?.snippet?.slice(0, 120) ?? '?'}`,
          );
          const scripts = (
            audits['network-requests']?.details as
              | { items?: { url: string; resourceType?: string; transferSize?: number }[] }
              | undefined
          )?.items
            ?.filter((r) => r.resourceType === 'Script')
            .sort((x, y) => (y.transferSize ?? 0) - (x.transferSize ?? 0))
            .slice(0, 6)
            .map(
              (r) => `${r.url.split('/').pop()} ${((r.transferSize ?? 0) / 1024).toFixed(1)} KB`,
            );
          console.log(`[lighthouse] ${url}: largest scripts ${scripts?.join(', ') ?? '?'}`);
          const metric = (id: string) => audits[id]?.displayValue ?? '?';
          console.log(
            `[lighthouse] ${url}: FCP ${metric('first-contentful-paint')} · LCP ${metric('largest-contentful-paint')} · TBT ${metric('total-blocking-time')} · CLS ${metric('cumulative-layout-shift')}`,
          );
          for (const a of Object.values(audits))
            if (a.score !== null && a.score < 0.9 && a.scoreDisplayMode === 'binary')
              console.log(`[lighthouse] ${url}: failing audit ${a.id} — ${a.title}`);
        }
      }
      perf.sort((x, y) => x - y);
      results[url] = { performance: perf, accessibility: a11y };
      console.log(
        `[lighthouse] ${url}: performance ${perf.map((s) => Math.round(s * 100)).join(' / ')} (median ${Math.round((perf[1] ?? 0) * 100)}) · accessibility ${Math.round(a11y * 100)}`,
      );
    }
    mkdirSync(test.info().outputDir, { recursive: true });
    writeFileSync(
      path.join(test.info().outputDir, 'lighthouse.json'),
      JSON.stringify(results, null, 2),
    );
    for (const [url, r] of Object.entries(results)) {
      expect(r.performance[1], `${url} performance (median)`).toBeGreaterThanOrEqual(
        TARGET.performance,
      );
      expect(r.accessibility, `${url} accessibility`).toBeGreaterThanOrEqual(TARGET.accessibility);
    }
  } finally {
    await ctx.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
