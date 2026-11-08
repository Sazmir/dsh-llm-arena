# dsh-llm-arena

English | [Русский](README.ru.md)

A DeepSeek Harness provider bundle for Arena API, optimized for the promotional **Arena Router** balance: OpenAI Responses routing, six compact model entries, additive runtime route restoration, and a narrow Windows Cloudflare compatibility fallback.

> [!WARNING]
> Model calls send conversation data—including prompts, system instructions, tool schemas and results, and attachments—to Arena and potentially its selected upstream provider. Calls, retries, and a fallback replay may consume credits. Installation, `dsh --profile web --dump-config`, `npm test`, and `npm run verify` make no model calls. The optional live smoke test is potentially billable and requires explicit opt-in.

> [!IMPORTANT]
> If the Arena dashboard shows funds under **Arena Router** and `$0.00` under **All models**, choose `coding-router-preview` or `claude-coding-router-preview`. The four direct Claude entries require a nonzero **All models** balance and otherwise return HTTP `402 paid_credits_required`.

## Requirements

- DeepSeek Harness `0.2.0-rc.2`
- Node.js 22 or newer
- An Arena API key
- PowerShell 7 (`pwsh`) only when the Windows fallback is needed

Other DSH releases may work, but are not claimed compatible until separately verified.

## What the bundle adds

- Provider id: `arena`
- Protocol: `openai-responses` (not Chat Completions)
- Base URL: `https://api.arena.ai/v1`
- Credential reference: `ARENA_API_KEY`
- Six preconfigured model ids
- Additive, in-memory restoration of a missing Arena route after profile overrides
- Native-first Windows fallback for a narrowly recognized Cloudflare block page

The bundle uses conservative fallback metadata of 262,144 context tokens, 32,768 output tokens, and text input for models whose exact Arena limits are not publicly verified. `coding-router-preview` carries the documented 1,000,000 context, 128,000 output, and text/image metadata. These are bundle catalog values, not an upstream service guarantee.

## Default models

| Model id | Display name | Access note |
| --- | --- | --- |
| `coding-router-preview` | Arena Router · Coding (promo) | Recommended for promotional **Arena Router** balance |
| `claude-coding-router-preview` | Arena Router · Claude (promo) | Recommended Claude-oriented choice for promotional **Arena Router** balance |
| `claude-fable-5-1` | All models · Claude Fable 5.1 | Direct selection; requires **All models** balance |
| `claude-opus-5-5` | All models · Claude Opus 5.5 | Direct selection; requires **All models** balance |
| `claude-sonnet-5-5` | All models · Claude Sonnet 5.5 | Direct selection; requires **All models** balance |
| `claude-haiku-5-5` | All models · Claude Haiku 5.5 | Direct selection; requires **All models** balance |

Catalog presence does not guarantee account entitlement, current availability, pricing, rate limits, or model limits. Check the current Arena dashboard for your account.

## Install

Prefer a release tag:

```sh
dsh plugin --profile web add github:Sazmir/dsh-llm-arena#v0.1.1
dsh --profile web --dump-config
dsh web
```

`--dump-config` only verifies composition and makes no provider request. Confirm that it contains the `llm-arena` row. Restart the existing DSH Web Host after package installation, refresh the page, then confirm that **Arena API** and the six model entries appear in the model picker.

Development installs may follow `main`:

```sh
dsh plugin --profile web add github:Sazmir/dsh-llm-arena
```

## Configure the key

Preferred flow:

1. Open DSH Web → Settings → Models.
2. Select **Arena API**.
3. Enter the Arena API key and apply the change.

DSH stores the value under the credential reference `ARENA_API_KEY`; the bundle configuration contains only that reference name.

Alternative launch environment on Windows:

```powershell
$env:ARENA_API_KEY = Read-Host "Arena API key" -MaskInput
dsh web
```

Alternative on POSIX:

```sh
read -rsp 'Arena API key: ' ARENA_API_KEY; echo
export ARENA_API_KEY
dsh web
```

Do not put a literal key in `cordis.patch.yml`, custom headers, command-line arguments, examples, screenshots, or logs.

## Cloudflare compatibility fallback

In default auto mode, every Arena request first uses the Fetch implementation already installed by DSH.

On Windows only, the bundle considers fallback only when the exact canonical origin `https://api.arena.ai` returns all of the following:

- HTTP `403`;
- HTML content;
- `server: cloudflare`;
- a nonempty `cf-ray` header;
- a recognized Cloudflare block-page marker within a bounded body prefix.

Only that affected request is replayed once through a local noninteractive PowerShell 7/.NET HttpClient helper. The next request starts with native Fetch again. Ordinary authentication, authorization, application, quota, and rate-limit responses do not trigger fallback. Native network errors are not replayed. Non-Arena origins are delegated unchanged, and macOS/Linux remain native-only.

The fallback security boundary:

- URL, method, headers, and body—including authorization—reach the local helper through stdin and process memory, never command-line arguments or temporary request files.
- The helper receives an environment allowlist rather than the complete parent environment.
- Redirects are disabled and fail closed.
- TLS verification remains enabled.
- Gzip, deflate, and Brotli are decompressed by .NET.
- SSE bytes stream through stdout with cancellation and Node backpressure.
- Request bodies are capped at 64 MiB.
- Replay means exactly-once delivery is not guaranteed.

## Runtime route restoration

DSH profile and bundle layers can replace the complete `llm-pi-ai.providers` map. A static bundle patch would therefore risk deleting providers from earlier layers.

This bundle inserts only its runtime plugin. During configuration resolution it adds the default `arena` route only when that route is missing. It preserves every other provider, leaves an explicit user-defined `arena` route unchanged, refuses malformed provider maps, and does not rewrite profile files.

## Development and offline verification

```sh
git clone https://github.com/Sazmir/dsh-llm-arena.git
cd dsh-llm-arena
npm ci
npm run verify
```

`npm run verify`, CI, and routine agent verification perform syntax checks, offline/mock tests, hygiene checks, and an npm package dry-run. They make zero Arena or model API calls regardless of ambient credentials.

### Optional live smoke test

This is a separate, explicitly opted-in, potentially billable request. Never run it in CI or routine agent verification.

PowerShell:

```powershell
$env:ARENA_LIVE_SMOKE = "1"
$env:ARENA_API_KEY = Read-Host "Arena API key" -MaskInput
npm run test:live
```

POSIX:

```sh
read -rsp 'Arena API key: ' ARENA_API_KEY; echo
ARENA_LIVE_SMOKE=1 ARENA_API_KEY="$ARENA_API_KEY" npm run test:live
```

The script refuses to run unless `ARENA_LIVE_SMOKE=1` and an environment key are both present. It never reads DSH credential files automatically.

## Troubleshooting

- **Arena API is absent from the picker:** verify DSH `0.2.0-rc.2`, inspect `--dump-config` for `llm-arena`, restart the existing Host, and refresh the page.
- **`MISSING_CREDENTIAL`:** configure the `ARENA_API_KEY` credential reference or launch environment.
- **Ordinary `401` or JSON `403`:** check the key, workspace, and account permissions; these do not activate fallback.
- **Recognized Cloudflare block on Windows but fallback fails:** install PowerShell 7 and ensure `pwsh` is on `PATH`.
- **Direct model returns an entitlement or credit error:** check the Arena account's all-model access and current balance.
- **Rate or quota error:** inspect the Arena dashboard; the bundle does not override account limits.

## Uninstall

```sh
dsh plugin --profile web remove dsh-llm-arena
```

Uninstalling the bundle does not necessarily delete or revoke the Arena key stored by DSH. Remove or rotate it separately when required.

## Security and license

See [SECURITY.md](SECURITY.md) for private reporting and trust boundaries.

MIT License. See [LICENSE](LICENSE).
