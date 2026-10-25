# CHANGELOG — RotationLab

All notable changes are documented here. Format based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/); versions follow [SemVer](https://semver.org/).

**Rules for the coding AI**
- Add an entry under `[Unreleased]` at the end of every phase/PR: what was built, what changed, what was fixed.
- Use sections: `Added`, `Changed`, `Fixed`, `Removed`, `Security`, `Docs`.
- Reference PRD/feature IDs (e.g. `DRAW-3`) and TODO phase.
- On release, move `[Unreleased]` items under a new version heading with the date.
- Record exact dependency versions resolved at scaffold time (see TECH_STACK.md version policy).

---

## [Unreleased]

### Docs
- 2026-10-25 — Initial specification pack created: README, PRD, ARCHITECTURE, UI_UX_SPEC, DATABASE_SCHEMA, API_SPEC, SECURITY, TECH_STACK, USER_FLOWS, FEATURES, ENVIRONMENT, TESTING, DEPLOYMENT, CHANGELOG, TODO.
- Verified PUBG `api-assets` map files: high-res art for Erangel (~95 MB), Miramar (~112 MB) and Rondo (~118–122 MB) is stored in Git LFS with labelled (`_Main_`) and unlabelled (`_Main_No_Text_`) variants; low-res variants are 819×819; `Rondo_Main_Low_Res.png` is actually JPEG data. Telemetry names: Erangel `Erangel_Main`/`Baltic_Main`, Miramar `Desert_Main`, Rondo `Neon_Main`.

### Added
- _nothing yet — Phase 0 not started_

---

## Template for future entries

```md
## [0.1.0] — YYYY-MM-DD
### Added
- Phase 1: monorepo scaffold (pnpm + Turborepo), shared package with Zod schemas, Docker Compose dev stack. (TODO P1)
### Security
- argon2id password hashing, refresh-token rotation with reuse detection. (AUTH-1, AUTH-3)
### Dependencies (resolved)
- next 15.x.y, react 19.x.y, leaflet 1.9.x, socket.io 4.8.x, fastify 5.x.y, prisma 6.x.y …
```
