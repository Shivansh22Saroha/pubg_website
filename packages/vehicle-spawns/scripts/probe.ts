/* eslint-disable */
/** Temporary probe (branch only): what does Rondo telemetry say about recalls? */
import { writeFile } from 'node:fs/promises';
const API = 'https://api.pubg.com';
const KEY = process.env.PUBG_API_KEY ?? '';
const N = Number(process.env.PROBE_MATCHES ?? 25);
const MAP = process.env.PROBE_MAP ?? 'Neon_Main';
async function api<T>(p: string): Promise<T> {
  for (let a = 0; ; a++) {
    const r = await fetch(`${API}${p}`, { headers: { authorization: `Bearer ${KEY}`, accept: 'application/vnd.api+json' } });
    if (r.status === 429 && a < 3) { await new Promise((x) => setTimeout(x, 15000)); continue; }
    if (!r.ok) throw new Error(`${p} ${r.status}`);
    return (await r.json()) as T;
  }
}
const SCRUB = new Set(['name', 'accountId', 'attackerName', 'victimName', 'teammates']);
function scrub(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(scrub);
  if (v && typeof v === 'object') return Object.fromEntries(Object.entries(v).filter(([k]) => !SCRUB.has(k)).map(([k, x]) => [k, scrub(x)]));
  return v;
}
const RX = /chip|recall|redeploy|respawn|tower|revival|comeback|heart|resurrect|rebirth|transmit/i;
async function main() {
  const s = await api<any>('/shards/steam/samples');
  const ids: string[] = s.data.relationships.matches.data.map((m: any) => m.id);
  const counts: Record<string, number> = {};
  const mapNames: Record<string, number> = {};
  const samples: Record<string, unknown[]> = {};
  const objTypes: Record<string, number> = {};
  const items: Record<string, number> = {};
  let used = 0;
  for (const id of ids) {
    if (used >= N) break;
    try {
      const m = await api<any>(`/shards/steam/matches/${id}`);
      const { mapName, matchType, gameMode } = m.data.attributes;
      mapNames[`${mapName}/${matchType}/${gameMode}`] = (mapNames[`${mapName}/${matchType}/${gameMode}`] ?? 0) + 1;
      if (mapName !== MAP || matchType !== 'official') continue;
      const url = m.included?.find((i: any) => i.type === 'asset')?.attributes?.URL;
      if (!url) continue;
      used++;
      const ev: any[] = await (await fetch(url)).json();
      for (const e of ev) {
        counts[e._T] = (counts[e._T] ?? 0) + 1;
        if (e._T === 'LogObjectInteraction' && e.objectType) objTypes[`${e.objectType}|${e.objectTypeStatus ?? ''}`] = (objTypes[`${e.objectType}|${e.objectTypeStatus ?? ''}`] ?? 0) + 1;
        const it = e.item?.itemId; if (typeof it === 'string') items[`${e._T}:${it}`] = (items[`${e._T}:${it}`] ?? 0) + 1;
        const str = JSON.stringify(e);
        if (RX.test(e._T) || RX.test(str.replace(/"(name|accountId)":"[^"]*"/g, ''))) {
          const k = e._T; samples[k] ??= [];
          if (samples[k].length < 400) samples[k].push({ match: id.slice(0, 8), ...(scrub(e) as object) });
        }
      }
      console.log(`match ${used}: ${ev.length} events`);
    } catch (err) { console.warn(String(err)); }
  }
  const out = { used, mapNames, counts, objTypes, items: Object.fromEntries(Object.entries(items).filter(([k]) => RX.test(k) || /Item_(Heal|Boost)/.test(k) === false).sort((a, b) => b[1] - a[1]).slice(0, 400)), samples };
  await writeFile('probe.json', JSON.stringify(out, null, 1));
  console.log(JSON.stringify({ used, mapNames, counts, objTypes }, null, 1));
}
main().catch((e) => { console.error(e); process.exit(1); });
