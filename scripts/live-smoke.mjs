import { createArenaFetch } from '../lib/transport.js'

if (process.env.ARENA_LIVE_SMOKE !== '1') {
  console.error('Refusing live Arena call: set ARENA_LIVE_SMOKE=1 only after explicit approval for a potentially billable request.')
  process.exit(2)
}

const apiKey = process.env.ARENA_API_KEY
if (typeof apiKey !== 'string' || apiKey.trim() === '') {
  console.error('ARENA_API_KEY is required in the process environment. This script never reads DSH credential files.')
  process.exit(2)
}

const arenaFetch = createArenaFetch(fetch)
const response = await arenaFetch('https://api.arena.ai/v1/responses', {
  method: 'POST',
  headers: {
    authorization: `Bearer ${apiKey}`,
    'content-type': 'application/json',
    'user-agent': 'dsh-llm-arena-live-smoke/0.1.1',
  },
  body: JSON.stringify({
    model: 'coding-router-preview',
    input: 'Reply with exactly ARENA_LIVE_OK',
    max_output_tokens: 16,
    store: false,
  }),
})

const text = await response.text()
if (!response.ok) {
  console.error(`Arena live smoke failed with HTTP ${response.status}; response body omitted.`)
  process.exit(1)
}
const payload = JSON.parse(text)
const output = payload.output
  ?.flatMap((item) => item.content ?? [])
  .map((part) => part.text ?? '')
  .join('')
if (output?.trim() !== 'ARENA_LIVE_OK') {
  console.error(`Arena live smoke returned an unexpected response model=${payload.model ?? 'unknown'}.`)
  process.exit(1)
}
console.log(`Arena live smoke passed: status=${response.status} model=${payload.model ?? 'unknown'}`)
