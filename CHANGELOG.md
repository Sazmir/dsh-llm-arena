# Changelog

All notable changes to this project are documented here.

## 0.1.1 - 2026-11-08

- Mark both Arena router entries as the recommended choices for promotional **Arena Router** balance.
- Mark direct Claude entries as requiring a nonzero **All models** balance.
- Add prominent English and Russian guidance for avoiding HTTP `402 paid_credits_required` on router-only promotional accounts.

## 0.1.0 - 2026-11-08

- Add the `arena` provider route for OpenAI Responses at `https://api.arena.ai/v1`.
- Preconfigure two Arena routers and four direct Claude model IDs.
- Restore a missing Arena route additively at runtime when later DSH profile layers replace `llm-pi-ai.providers`.
- Add a Windows-only, native-first Cloudflare compatibility fallback through PowerShell 7 and .NET HttpClient.
- Preserve streaming, cancellation, response backpressure, decompression, origin fencing, and fail-closed redirects.
- Add offline tests, Windows/Linux CI, bilingual documentation, and an explicit opt-in live smoke test.
