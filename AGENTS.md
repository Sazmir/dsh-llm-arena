# AGENTS.md

## Scope

These instructions apply to the entire repository. This project is a standalone DeepSeek Harness provider bundle for Arena API, not an Arena UI or general-purpose proxy.

## Product invariants

- Provider id: `arena`.
- Protocol: `openai-responses`, not Chat Completions.
- Base URL: `https://api.arena.ai/v1`.
- Credential reference: `ARENA_API_KEY`; never put a literal key in configuration, headers, examples, tests, screenshots, logs, or command arguments.
- Default model ids and order live in `lib/route.js` and must match both READMEs:
  1. `coding-router-preview`
  2. `claude-coding-router-preview`
  3. `claude-fable-5-1`
  4. `claude-opus-5-5`
  5. `claude-sonnet-5-5`
  6. `claude-haiku-5-5`
- `cordis.patch.yml` inserts only `llm-arena`. It must not patch `llm-pi-ai` statically because a bundle patch would replace providers contributed by earlier bundles.
- Runtime route restoration adds only a missing default `arena` route, preserves every other provider, respects an explicit user-defined `arena` route, refuses malformed provider maps, and never writes profile files.
- Transport interception is limited to the exact canonical origin `https://api.arena.ai`.
- Native Fetch runs first for every request. On Windows only, one request may replay through PowerShell/.NET only after a strong Cloudflare challenge signature: HTTP `403`, HTML content, `server: cloudflare`, nonempty `cf-ray`, and a recognized block-page marker.
- Ordinary authentication, authorization, application, quota, and rate-limit responses never trigger fallback. Generic native transport errors never trigger fallback.
- Fallback redirects are disabled, TLS verification stays enabled, SSE preserves cancellation and backpressure, and request bodies remain bounded.

## File map

- `package.json` — package, release, compatibility, and verification commands.
- `cordis.patch.yml` — inserts the runtime plugin only.
- `lib/route.js` — canonical default Arena route and compact model catalog.
- `lib/route-survival.js` — additive loader hook and initial volatile route registration.
- `lib/index.js` — Cordis entry point; installs route survival on every OS and Windows transport wrapping only on Windows.
- `lib/transport.js` — exact-origin request normalization, Cloudflare classification, replay, streaming, cancellation, and child-process hygiene.
- `lib/invoke-arena.ps1` — PowerShell 7/.NET streaming HTTP helper.
- `test/` — offline tests only.
- `scripts/live-smoke.mjs` — the only code allowed to make a live Arena model request.
- `README.md` / `README.ru.md` — structurally parallel public documentation.
- `SECURITY.md` — reporting and trust boundaries.

## Mandatory test rule

**`npm test`, `npm run verify`, CI, pre-commit hooks, and routine agent verification MUST make zero requests to `api.arena.ai` or any billable model API. The presence of `ARENA_API_KEY`, a DSH credential file, or another ambient secret is not consent.**

**Only `npm run test:live` may contact Arena, and only when `ARENA_LIVE_SMOKE=1` and an environment key are both present. An automated agent must not set that flag or run the command without a direct human instruction authorizing billable calls for the current task.**

The live script must never read `~/.dsh/.credentials.yaml` or another credential file automatically.

## Required workflow

1. Read the relevant source, tests, and both README language versions.
2. Make the smallest change that preserves the invariants above.
3. For route/model changes, update `lib/route.js`, route tests, and both model tables.
4. For transport changes, cover non-Arena pass-through, canonical-origin rejection, ordinary errors, strong Cloudflare challenge detection, one-request replay, second-request native recovery, request fidelity, redirect refusal, abort, backpressure, size limits, and environment redaction.
5. Run `npm ci` and `npm run verify`.
6. Inspect the dry-run package contents and run the secret/path hygiene test.
7. Keep English and Russian documentation structurally aligned.

## Security invariants

- Never broaden the origin or Cloudflare challenge classifier for convenience.
- Never retry generic network errors or ordinary `401`, `403`, `429`, quota, or model errors.
- Never disable TLS verification.
- Never interpolate URL, headers, credentials, or body into shell command arguments.
- Send helper input through stdin; do not create request temporary files.
- Do not log keys, authorization headers, prompts, tool payloads, responses, Cloudflare HTML, IP addresses, ray ids, or local absolute paths.
- Keep child environment inheritance allowlisted and exclude API keys, proxy credentials, and unrelated secrets.
- Preserve fail-closed redirects, upload cancellation, response backpressure, decompression, and body-size limits.
- Treat fallback as replay: do not claim exactly-once delivery.

## Public hygiene

Before every release, verify that tracked and packed files contain no credentials, `.env` files, DSH credential files, logs, archives, account ids, request ids, IP addresses, or machine-local absolute paths. Keep pricing and model availability claims qualified as Arena-controlled and account-dependent.
