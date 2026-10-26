/**
 * E2E-only API supervisor: runs the API as a child process and exposes a control port so a
 * Playwright test can kill and restart it mid-session (FEATURES F8: clients must recover
 * without a reload). Not for production.
 *
 *   PORT=4200 E2E_CONTROL_PORT=4299 tsx scripts/e2e-api.ts
 *   POST http://127.0.0.1:4299/restart   → kill the API, start it again, wait until healthy
 */
import { execFileSync, spawn, type ChildProcess } from 'node:child_process';
import { once } from 'node:events';
import http from 'node:http';

const PORT = Number(process.env.PORT ?? 4200);
const CONTROL = Number(process.env.E2E_CONTROL_PORT ?? 4299);
let child: ChildProcess | null = null;

/**
 * `/explore` needs demo boards: seed them (idempotent) and hand their ids to the API, unless
 * the environment already names some.
 */
function seedDemoBoards() {
  if (process.env.DEMO_BOARD_IDS) return;
  const out = execFileSync(
    process.execPath,
    ['--import', 'tsx', '--env-file-if-exists=.env', 'scripts/seed.ts', '--demo-only'],
    { env: process.env, encoding: 'utf8' },
  );
  const ids = /^DEMO_BOARD_IDS=(.*)$/m.exec(out)?.[1]?.trim();
  if (!ids)
    throw new Error(`seed printed no DEMO_BOARD_IDS:
${out}`);
  process.env.DEMO_BOARD_IDS = ids;
}
seedDemoBoards();

function start() {
  // one node process (no tsx wrapper) so a kill really frees the port
  child = spawn(
    process.execPath,
    ['--import', 'tsx', '--env-file-if-exists=.env', 'src/index.ts'],
    {
      stdio: 'inherit',
      env: process.env,
    },
  );
}

async function stop() {
  const c = child;
  child = null;
  if (!c || c.exitCode !== null) return;
  const exited = once(c, 'exit');
  c.kill('SIGKILL'); // a hard kill, like a crash
  await exited;
}

async function healthy(timeoutMs = 60_000) {
  const until = Date.now() + timeoutMs;
  while (Date.now() < until) {
    try {
      const res = await fetch(`http://127.0.0.1:${PORT}/api/health`);
      if (res.ok) return;
    } catch {
      // not up yet
    }
    await new Promise((r) => setTimeout(r, 200));
  }
  throw new Error('API did not become healthy');
}

http
  .createServer((req, res) => {
    void (async () => {
      try {
        if (req.method === 'POST' && req.url === '/restart') {
          const downMs = Number(new URL(req.url, 'http://x').searchParams.get('downMs') ?? 0);
          await stop();
          if (downMs > 0) await new Promise((r) => setTimeout(r, downMs));
          start();
          await healthy();
          res.end('restarted');
        } else if (req.method === 'POST' && req.url === '/stop') {
          await stop();
          res.end('stopped');
        } else if (req.method === 'POST' && req.url === '/start') {
          if (!child) start();
          await healthy();
          res.end('started');
        } else {
          res.statusCode = 404;
          res.end();
        }
      } catch (err) {
        res.statusCode = 500;
        res.end(String(err));
      }
    })();
  })
  .listen(CONTROL, '127.0.0.1');

for (const sig of ['SIGINT', 'SIGTERM'] as const) {
  process.on(sig, () => {
    void stop().then(() => process.exit(0));
  });
}
process.on('exit', () => {
  child?.kill('SIGKILL');
});

start();
