# SECURITY — RotationLab

Baseline: **OWASP ASVS 4.0 Level 1**, plus the realtime-specific controls below. Every item marked **MUST** is a release blocker.

## 1. Assets & trust boundaries
| Asset | Why it matters |
|---|---|
| User accounts (email, password hash, sessions) | account takeover, credential stuffing |
| Room content (strategies, enemy notes, chat) | competitive teams treat plans as secret |
| Room membership & roles | unauthorized edit/delete of a team's work |
| Service availability | live scrim prep can't afford downtime / floods |

Boundaries: browser ↔ proxy (untrusted input), proxy ↔ app (internal), app ↔ Postgres/Redis (private network only), tile CDN (public, static).

## 2. Authentication
| # | Control |
|---|---|
| A1 **MUST** | Passwords hashed with **argon2id** (`@node-rs/argon2`), params: memory 19 MiB, iterations 2, parallelism 1 (OWASP minimum) — tune so a hash takes ~100–250 ms on prod hardware. Never log, return or store plaintext. |
| A2 **MUST** | Password policy: 10–128 chars, no composition rules, reject top breached passwords (bundled list of 100k, or HaveIBeenPwned k-anonymity range API when online). |
| A3 **MUST** | Access token: JWT HS256 (`jose`), 15 min, claims `{ sub, sid, iat, exp, iss, aud }` only — no roles in the token (roles are looked up per request so changes apply instantly). Secret ≥ 32 random bytes from env. |
| A4 **MUST** | Refresh token: 256-bit random opaque string, stored as SHA-256 hash, 30-day expiry, **rotated on every use**. Reuse of an already-rotated token ⇒ revoke the whole token family and force re-login (theft detection). |
| A5 **MUST** | Cookies: `HttpOnly`, `Secure`, `SameSite=Lax` (access) / `Strict` + `Path=/api/v1/auth` (refresh). Use `__Host-` prefix for the access cookie in production. |
| A6 **MUST** | Login throttling: per-IP 10 / min, per-account 5 failures → 15 min lock (exponential up to 24 h), stored in Redis + `users.locked_until`. Generic error message for wrong email/username/password. |
| A7 **MUST** | Constant-time comparisons for token hashes; perform a dummy argon2 verify when the user doesn't exist (timing-safe enumeration defense). |
| A8 | Password change / reset revokes all other sessions. |
| A9 | Email verification & reset tokens: 256-bit, single-use, hashed at rest, 30 min (reset) / 24 h (verify). `forgot-password` always returns 202. |
| A10 | Username availability endpoint rate-limited 20 / min / IP. |

## 3. Authorization
| # | Control |
|---|---|
| Z1 **MUST** | Every REST handler and every socket event resolves `(userId, roomId) → role` from DB (cached in Redis 30 s, cache busted on role change/kick) and checks it via `policy.ts`. Never trust `roomId`/`boardId` from the client without verifying the board belongs to that room. |
| Z2 **MUST** | Non-members get `404 NOT_FOUND` for room-scoped resources (no existence leak). |
| Z3 **MUST** | Permission matrix (single source in `packages/shared/src/permissions.ts`): |

| Action | OWNER | EDITOR | VIEWER |
|---|---|---|---|
| View boards, chat, presence | ✓ | ✓ | ✓ |
| Send chat, pings, laser, cursor | ✓ | ✓ | ✓ |
| Create/edit/delete elements & layers | ✓ | ✓ | ✗ |
| Create/rename boards, snapshots, restore | ✓ | ✓ | ✗ |
| Delete boards | ✓ | ✗ | ✗ |
| Create invites | ✓ | ✓ (role ≤ EDITOR) | ✗ |
| Change roles, kick, room settings, password, delete room | ✓ | ✗ | ✗ |
| Delete any chat message | ✓ | own only | own only |

| # | Control |
|---|---|
| Z4 **MUST** | Locked layers reject element ops server-side (not just hidden in UI). |
| Z5 **MUST** | Kick / role downgrade takes effect immediately: server removes the user's sockets from the room channels and disconnects them. |
| Z6 | Room passwords hashed with argon2id; checked only at join time; wrong attempts rate-limited 5 / 10 min per user+room. |
| Z7 | Invite codes: 10 chars Crockford base32 from CSPRNG (~50 bits) + `GET /invites/:code` rate limit 30 / min / IP — brute force infeasible. Expiry and max-uses enforced in the accept transaction (`use_count < max_uses` with row lock). |

## 4. Input validation & output encoding
| # | Control |
|---|---|
| V1 **MUST** | Every REST body/query and every socket payload parsed with the shared **Zod** schema; unknown keys stripped (`.strict()` on inputs). Reject on failure. |
| V2 **MUST** | Geometry limits: integer coords within `[0, worldSize]`, stroke ≤ 2 000 points, polygon ≤ 200, arrow ≤ 50, element JSON ≤ 64 KB, ≤ 5 000 elements/board, batch ≤ 50 ops. |
| V3 **MUST** | Text fields length-limited (see DB schema), trimmed, Unicode NFC-normalised, control chars (except `\n` in chat) stripped. |
| V4 **MUST** | **No HTML rendering of user content anywhere.** Chat, labels, names rendered as React text nodes; never `dangerouslySetInnerHTML`. Markdown is not supported in v1. Leaflet tooltips/popups built with `textContent`, not HTML strings. |
| V5 **MUST** | Colors validated by `^#[0-9A-Fa-f]{6}$` before use in SVG/CSS (prevents CSS/SVG injection via style strings). |
| V6 | URLs in chat are shown as plain text (no auto-linking in v1). |
| V7 **MUST** | Prisma parameterised queries only; any raw SQL uses `$queryRaw` tagged templates, never string concatenation. |

## 5. Transport & browser security
| # | Control |
|---|---|
| T1 **MUST** | HTTPS only, HSTS `max-age=63072000; includeSubDomains; preload` (enable preload after testing). TLS via Caddy auto-certificates. |
| T2 **MUST** | WebSockets over `wss://` only; server verifies `Origin` header on handshake against `APP_ORIGIN`. |
| T3 **MUST** | CSRF: SameSite cookies + `Origin` check + custom header `X-Requested-With` on all mutating REST calls. |
| T4 **MUST** | Security headers (set at proxy or `@fastify/helmet` + Next config): |

```
Content-Security-Policy:
  default-src 'self';
  script-src 'self' 'nonce-{random}';
  style-src 'self' 'unsafe-inline' https://fonts.googleapis.com;
  font-src 'self' https://fonts.gstatic.com;
  img-src 'self' data: blob: https://tiles.example.com;
  connect-src 'self' wss://app.example.com https://tiles.example.com;
  frame-ancestors 'none'; base-uri 'self'; form-action 'self'; object-src 'none'
X-Content-Type-Options: nosniff
Referrer-Policy: strict-origin-when-cross-origin
Permissions-Policy: camera=(), microphone=(), geolocation=()
Cross-Origin-Opener-Policy: same-origin
```
(Tighten `style-src` later by removing `'unsafe-inline'` if feasible — Leaflet sets inline styles, so it is currently required.)

| T5 | No CORS in production (same origin). In dev, allow only `http://localhost:3000` with credentials. |

## 6. Rate limiting & abuse (DoS)
| Scope | Limit |
|---|---|
| Global per IP (REST) | 300 req / min |
| `/auth/login`, `/auth/register` | 10 / min / IP; register 5 / hour / IP |
| `/auth/forgot-password` | 3 / hour / email + 10 / hour / IP |
| Room creation | 10 / day / user, max 30 owned rooms |
| Invite accept | 20 / hour / user |
| Socket limits | see API_SPEC §7.4 |
| Body size | REST 100 KB (snapshots restore via id, not body); socket 64 KB |

Implement with `@fastify/rate-limit` (Redis store) and per-socket token buckets. Proxy also limits connections per IP (e.g. 50 concurrent).

## 7. Data protection & privacy
- Postgres and Redis **not exposed** publicly; Redis requires password (`requirepass`) and runs on the internal Docker network.
- Disk encryption at rest from the VM/cloud provider; daily encrypted DB backups (age/GPG) to off-site storage, 14-day retention; restore tested monthly.
- IP addresses stored only as salted SHA-256 (`IP_HASH_SALT`) in audit logs and sessions.
- Logs: never log passwords, tokens, cookies, chat bodies, room passwords. Pino redaction paths configured for `req.headers.cookie`, `*.password`, `*.token`.
- Account deletion: anonymise within 30 days (see DB schema §6).
- No third-party analytics by default. If added, cookie-less (e.g. self-hosted Plausible) and documented in the privacy page.

## 8. Secrets management
- All secrets via environment variables (ENVIRONMENT.md). `.env*` in `.gitignore`; `.env.example` contains placeholders only.
- Production secrets in the host's secret store / GitHub Actions encrypted secrets — never in images or compose files committed to git.
- Rotate `JWT_SECRET` support: accept `JWT_SECRET_PREVIOUS` for 15 min during rotation.
- `gitleaks` runs in CI on every push.

## 9. Dependency & supply chain
- `pnpm audit --prod` and GitHub Dependabot (weekly); fail CI on high/critical in prod dependencies.
- Lockfile committed; `pnpm install --frozen-lockfile` in CI and Docker.
- Docker images: `node:22-alpine` (or distroless) base, run as non-root user, read-only root FS where possible, `HEALTHCHECK` set.
- Map tile script verifies SHA-256 of downloaded LFS objects against the pointer `oid`, and checks image magic bytes before processing (treat downloaded files as untrusted; run `sharp` with `limitInputPixels` set to the expected size, not `false`, once the real size is known).

## 10. Threat model (STRIDE summary)
| Threat | Example | Mitigation |
|---|---|---|
| Spoofing | Stolen refresh token | rotation + reuse detection (A4), httpOnly cookies, logout-all |
| Spoofing | Credential stuffing | rate limits, lockout, breached-password check (A2, A6) |
| Tampering | Viewer sends `element:upsert` via devtools | server-side role + layer-lock checks (Z1, Z4) |
| Tampering | Element on board of another room | board→room ownership check per op (Z1) |
| Repudiation | "Who deleted our plan?" | `updated_by` on elements, op log 24 h, audit log for destructive actions, auto-snapshot before restore |
| Info disclosure | IDOR on `/rooms/:id` | membership check, 404 for non-members (Z2) |
| Info disclosure | Invite code guessing | 50-bit codes + rate limit + expiry (Z7) |
| Info disclosure | XSS via chat/label stealing data | no HTML rendering (V4), CSP with nonces (T4) |
| DoS | Socket flood of cursor events | token buckets, volatile drop, disconnect abusers |
| DoS | Giant stroke / 100k elements | payload + count limits (V2) |
| DoS | Many rooms/accounts | per-IP/user creation limits, optional Turnstile/hCaptcha on register (env flag) |
| Elevation | Editor makes self Owner | role changes OWNER-only, enforced server-side; ownership transfer requires password |
| Elevation | Kicked user keeps socket open | forced disconnect + membership re-check on every event (Z5) |

## 11. Security testing (see TESTING.md §5)
- Automated authz matrix tests for every endpoint and socket event × role.
- OWASP ZAP baseline scan in CI against staging.
- Manual checklist before each release: cookie flags, headers (securityheaders.com A), CSP violations in console = 0, rate limits verified.

## 12. Incident response (lightweight)
1. Detect (Sentry alerts, error-rate spikes, user report to `security@` address in footer).
2. Contain: rotate `JWT_SECRET` (invalidates all access tokens), revoke all refresh tokens via SQL if needed, enable maintenance mode.
3. Fix, deploy, write a short post-mortem in `docs/incidents/`.
4. Notify affected users if personal data was exposed.

## 13. Responsible disclosure
Publish `/.well-known/security.txt` with contact email and a 90-day disclosure window.
