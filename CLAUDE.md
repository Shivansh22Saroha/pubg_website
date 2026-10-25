# CLAUDE.md — RotationLab

Real-time collaborative BGMI/PUBG tactical map sandbox. The full spec lives in `docs/` (start with `README.md`, then `docs/TODO.md`).

## Non-negotiable rules

1. **Phase order.** Build strictly in `docs/TODO.md` phase order. Never start a phase until the previous one meets its exit criteria.
2. **World units only.** All coordinates are stored in PUBG world units (centimetres, `0–816000`) — never pixels or Leaflet lat/lng. See `docs/ARCHITECTURE.md` §5.
3. **Shared Zod schemas.** Every REST body/query and every socket payload is validated with the Zod schemas in `packages/shared`. Never duplicate a type — infer it (`z.infer`) and import it.
4. **Authorization via `policy.ts`.** Every REST route and every socket event checks authorization through `policy.ts` (`docs/SECURITY.md` §3). Non-members get `404`, never `403`.
5. **No HTML from user content.** Never render user content as HTML (no `dangerouslySetInnerHTML`, no Leaflet HTML strings). Never store tokens in `localStorage` (httpOnly cookies only).
6. **End of every phase:** run `pnpm lint`, `pnpm typecheck` and `pnpm test`; update `docs/CHANGELOG.md`; tick `docs/TODO.md`; then **stop and report** to the user. Wait for "next phase".
7. **Ask first** before adding a dependency not listed in `docs/TECH_STACK.md`, or before changing any spec decision.

## Conventions

- Unresolved Phase 0 decisions use the defaults in the docs and are marked with `// TODO(phase0): …` comments. Search for `TODO(phase0)` before launch.
- Version policy: `docs/TECH_STACK.md` lists target majors; stay on them. Resolved versions are recorded in `docs/CHANGELOG.md`.
- Booleans from env use `z.enum(['true','false']).transform(...)`, never `z.coerce.boolean()`.
- Layering on the server: route/handler → service → Prisma. Policies are called from services.

## Commands

| Command | What |
|---|---|
| `docker compose up -d postgres redis` | dev infra |
| `pnpm dev` | web (3000) + server (4000) in watch mode |
| `pnpm lint` / `pnpm typecheck` / `pnpm test` | checks (all must pass at end of phase) |
| `pnpm build` | production build |
| `pnpm format` | Prettier write |
