# TESTING — RotationLab

## 1. Strategy
| Level | Tool | Scope | Runs |
|---|---|---|---|
| Unit | Vitest | pure logic: schemas, coords, permissions, tools, stores, services with mocked repos | every commit (pre-push + CI) |
| Integration | Vitest + Testcontainers (Postgres, Redis) + `fastify.inject` + socket.io-client | REST endpoints, socket handlers, transactions, rate limits | CI on every PR |
| E2E | Playwright (Chromium, Firefox, WebKit; 2–3 browser contexts per test for collaboration) | user flows from USER_FLOWS.md | CI on PR (Chromium), nightly (all browsers) |
| Security | Vitest authz matrix, OWASP ZAP baseline, `pnpm audit`, gitleaks | see §5 | CI + nightly |
| Load | k6 (WebSocket) or Artillery (Socket.IO engine) | realtime throughput/latency | before release, manual |
| Visual | Playwright screenshots of key screens | regressions in layout | nightly |

## 2. Coverage targets
- `packages/shared`: ≥ 95 % lines.
- `apps/server` services & policy: ≥ 85 % lines; **100 % of permission matrix cells** tested.
- `apps/web` stores + tools: ≥ 80 %; components: key ones only.
- Coverage is a floor, not a goal — every bug fix adds a regression test.

## 3. Required unit tests
### Shared
- `coords.ts`: world↔LatLng round trip; `gridRef` for corners (`[0,0]→A-I`, `[815999,815999]→H-P`), boundaries at exactly 102 000; sub-square digits.
- Distance & travel time formatting.
- Every Zod schema: valid sample passes; each limit (points 2001, coord −1, coord > worldSize, color `red`, label 25 chars, unknown key) fails.
- `permissions.ts`: table-driven test of the matrix in SECURITY §3.

### Server
- Token service: sign/verify, expired, wrong audience, previous-secret acceptance.
- Refresh rotation: rotate → old token reuse → whole family revoked.
- Password policy & argon2 verify (incl. dummy verify path timing call present).
- Invite code generator: length, alphabet, uniqueness over 100k.
- Element service: seq increment, LWW (stale seq ignored), element count limit, locked layer rejection.
- Snapshot restore builds correct transaction and auto-snapshot.

### Web
- Each tool class: pointer sequences → expected `ElementInput` (pen simplification, polygon close, arrow finish on Enter, circle radius).
- `boardStore`: optimistic apply, ack clears pending, reject rolls back, incoming op with lower seq ignored, undo/redo incl. skip when seq changed.
- Reconnect queue: ops queued while offline are flushed once, in order, deduped by opId.

## 4. Required integration tests
### REST
| Area | Cases |
|---|---|
| Auth | register success/duplicate/weak password; login by email & username; wrong password generic error; lockout after 5; refresh rotation; logout revokes; logout-all; cookies have HttpOnly/Secure/SameSite attributes in prod config |
| CSRF | mutating request without `X-Requested-With` → 403; wrong `Origin` → 403 |
| Rooms | create (creates board + 3 layers in one txn); list only own rooms; non-member GET → 404; update by Editor → 403; delete soft-deletes |
| Invites | create with expiry; accept; expired → 410; max uses enforced under **concurrent accepts** (fire 10 in parallel with max_uses 3 → exactly 3 succeed); password wrong → 403; room full → 422 |
| Members | role change, kick (and socket disconnect asserted), owner can't leave |
| Boards | create/duplicate/rename/reorder; limit 20; can't delete last |
| Snapshots | save, list, restore → `board:reset` emitted; auto snapshot created |
| Chat | pagination order & cursor; delete own / owner deletes any / other → 403 |
| Rate limits | login 11th request in a minute → 429 with Retry-After |

### Realtime
| Case | Expectation |
|---|---|
| Connect without cookie | `connect_error` UNAUTHENTICATED |
| Connect with bad Origin | rejected |
| `room:join` non-member | ack `{ ok:false, code:'NOT_FOUND' }` |
| Viewer `element:upsert` | ack FORBIDDEN, nothing broadcast, DB unchanged |
| Element on board of a different room | FORBIDDEN |
| Two clients upsert same element concurrently | both get acks with distinct seqs; final DB state = higher seq; both clients converge |
| `board:subscribe {sinceSeq}` within log | delta mode with exact missing ops |
| `sinceSeq` older than log | full mode |
| Duplicate `opId` resend | idempotent (same seq returned, no double apply) |
| Kick while connected | target receives `member:kicked` then is disconnected; further emits fail |
| Flood 200 `element:upsert` in 1 s | RATE_LIMITED acks beyond bucket; abusive client disconnected after threshold |
| Oversized payload (> 64 KB) | connection rejects message |
| Volatile cursor spam | server stays responsive; others receive ≤ 20 Hz |

## 5. Security testing
1. **Authz matrix test** — generated: for every REST route and socket event × {anonymous, non-member, VIEWER, EDITOR, OWNER} assert expected status/ack. Fails CI if any route lacks an entry.
2. **Input fuzzing** — fast-check property tests on Zod schemas and socket handlers (random JSON must never crash the server or write invalid rows).
3. **XSS** — E2E: chat message and marker label `<img src=x onerror=alert(1)>` render as literal text; no dialog fires; CSP report count 0.
4. **IDOR** — swap IDs between two users' rooms/boards/snapshots/messages in every endpoint.
5. **Session** — refresh-token reuse detection; access token still valid after logout? (≤ 15 min accepted; sockets must be dropped immediately).
6. **Headers** — integration test asserts CSP, HSTS (prod), nosniff, frame-ancestors.
7. **ZAP baseline** — against staging nightly; fail on High.
8. **Dependencies & secrets** — `pnpm audit --prod --audit-level=high`, gitleaks on every push.

## 6. E2E scenarios (Playwright)
| ID | Flow | Key assertions |
|---|---|---|
| E2E-1 | UF-1 + UF-2 | register → dashboard → logout → login |
| E2E-2 | UF-3 + UF-4 + UF-5 | owner creates room, copies invite; second context joins; both see each other in presence |
| E2E-3 | UF-6 | A draws arrow, circle, enemy marker; B sees all three within 1 s; B moves marker; A sees new position |
| E2E-4 | Chat ping | B sends ping; A clicks chip; map center within tolerance of ping coordinates; pulse element visible |
| E2E-5 | Roles | owner sets B to Viewer; B's toolbar shows 3 tools; B attempt via `page.evaluate` socket emit is rejected |
| E2E-6 | UF-10 kick | B gets modal and is on dashboard; room not listed |
| E2E-7 | UF-11 | snapshot save → modify → restore → state equals snapshot in both contexts |
| E2E-8 | UF-13 | `context.setOffline(true)` → draw 3 shapes → online → other context receives exactly 3 |
| E2E-9 | Layers | lock layer → B cannot select/erase its elements |
| E2E-10 | Maps | each map loads tiles (no 404 in network log), labels toggle swaps tile URL, grid toggles |
| E2E-11 | Export | PNG downloads, non-zero size, dimensions = viewport × DPR |
| E2E-12 | Mobile viewport (iPhone 13) | view + chat mode, limited tools, chat sheet works |
| E2E-13 | Accessibility | `@axe-core/playwright` on landing, auth, dashboard, room (non-map regions): 0 serious/critical |

## 7. Performance & load
- Lighthouse CI on landing and dashboard: Performance ≥ 85, Accessibility ≥ 95.
- Map render benchmark (Playwright + `performance.now`): load board with 1 000 mixed elements, pan for 5 s, average frame time < 16.7 ms on CI runner baseline (report trend; hard fail only on > 2× regression).
- k6 socket load: 100 rooms × 5 users, each user 2 ops/s + 20 Hz cursor for 10 min on staging VM spec → p95 op broadcast latency < 400 ms, error rate < 0.1 %, server CPU < 70 %.

## 8. Test data & environment
- Factories in `apps/server/test/factories.ts` (user, room with members, board with N elements).
- Each integration test file gets a fresh schema (Testcontainers + `prisma migrate deploy`), truncation between tests.
- Playwright uses `globalSetup` to seed via API and saves `storageState` per user.
- Tiles in tests: a tiny fixture tile set (zoom 0–2, solid colors) to keep CI fast; one nightly test against real tiles.

## 9. Definition of done (per feature)
- [ ] Unit + integration tests written and passing
- [ ] Authz matrix entries added
- [ ] E2E updated if a user flow changed
- [ ] No new axe violations
- [ ] Docs (FEATURES/API_SPEC) updated
- [ ] CHANGELOG entry
