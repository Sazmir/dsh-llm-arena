# Security Policy

## Supported versions

| Package | DeepSeek Harness | Node.js | Status |
| --- | --- | --- | --- |
| `0.1.x` | `0.2.0-rc.2` | `>=22` | Supported |

Only the latest published `0.1.x` release is supported. Other DSH releases may work, but are not covered until separately verified.

## Report a vulnerability privately

Use [GitHub Private Vulnerability Reporting](https://github.com/Sazmir/dsh-llm-arena/security/advisories/new). Do not open a public issue containing exploit details, API keys, prompts, model responses, or private repository content.

Include:

- package, DSH, Node.js, PowerShell, and OS versions;
- a redacted reproduction using fixtures or mocks where possible;
- expected and observed behavior;
- security impact and affected trust boundary.

## In scope

Examples include:

- credentials or request bodies reaching a non-Arena origin;
- an ordinary authentication, authorization, quota, or application error incorrectly triggering fallback replay;
- command or argument injection into the PowerShell helper;
- credentials, headers, bodies, or local paths entering logs or package artifacts;
- unsafe redirect or TLS handling;
- route restoration deleting or overwriting another provider or an explicit user-defined `arena` route;
- secrets accidentally included in the npm/GitHub package.

## Credential and data flow

The bundle configuration stores only the credential reference name `ARENA_API_KEY`. The actual value is resolved by DSH from its credential store or from the launch environment. The plugin does not write a literal key into its route configuration.

A model request sends the conversation payload to Arena and potentially to the upstream provider selected by Arena. The payload can include prompts, system instructions, tool definitions and results, and attachments. This project cannot guarantee Arena or upstream retention, training, disclosure, or privacy behavior.

When the Windows fallback activates, the local PowerShell helper necessarily receives request headers and body—including authorization—through stdin and process memory. They are not placed in command-line arguments, temporary files, or normal logs. The child receives a small environment allowlist rather than the parent process environment.

If a credential may have leaked, revoke or rotate it in Arena and remove or replace the corresponding DSH credential reference.

## Transport boundary

- Only the exact canonical origin `https://api.arena.ai` is intercepted.
- Native DSH/Node Fetch is always attempted first.
- On Windows, only a narrowly recognized Cloudflare HTML `403` may replay once through local PowerShell 7 and .NET HttpClient.
- Ordinary Arena errors and all non-Arena origins remain on the native transport.
- Redirects in the fallback are disabled and fail closed.
- TLS verification remains enabled.
- The fallback is a compatibility transport, not a sandbox and not protection from malicious local processes or plugins.

## Safe reproductions

Use local fixtures and mocked Fetch responses first. Do not make a billable live proof of concept without private coordination and explicit approval. The default test suite and CI never call Arena or any model API.

## Out of scope

- Arena or upstream outages, latency, model quality, pricing, rate limits, and account entitlements;
- compromised operating systems, GitHub accounts, Arena accounts, or DSH installations;
- unsupported DSH or Node.js versions;
- user modifications that broaden origin matching, disable TLS checks, enable redirects, or log sensitive request data.
