import assert from 'node:assert/strict'
import test from 'node:test'
import { ARENA_PROVIDER, ARENA_ROUTE, PI_AI_ENTRY } from '../lib/route.js'
import {
  arenaRouteState,
  claimArenaRoute,
  watchArenaRoute,
  withArenaRoute,
} from '../lib/route-survival.js'

const EXPECTED_MODELS = [
  'coding-router-preview',
  'claude-coding-router-preview',
  'claude-fable-5-1',
  'claude-opus-5-5',
  'claude-sonnet-5-5',
  'claude-haiku-5-5',
]

const EXPECTED_NAMES = [
  'Arena Router · Coding (promo)',
  'Arena Router · Claude (promo)',
  'All models · Claude Fable 5.1',
  'All models · Claude Opus 5.5',
  'All models · Claude Sonnet 5.5',
  'All models · Claude Haiku 5.5',
]

test('route metadata stays narrow and deterministic', () => {
  assert.equal(ARENA_PROVIDER, 'arena')
  assert.deepEqual(PI_AI_ENTRY, { id: 'llm-pi-ai', name: '@deepseek-ai/dsh-llm-pi-ai' })
  assert.equal(ARENA_ROUTE.api, 'openai-responses')
  assert.equal(ARENA_ROUTE.baseURL, 'https://api.arena.ai/v1')
  assert.equal(ARENA_ROUTE.apiKeyEnv, 'ARENA_API_KEY')
  assert.equal(ARENA_ROUTE.defaultContextWindow, 262144)
  assert.equal(ARENA_ROUTE.defaultMaxTokens, 32768)
  assert.deepEqual(ARENA_ROUTE.defaultInput, ['text'])
  assert.deepEqual(ARENA_ROUTE.models.map((model) => model.id), EXPECTED_MODELS)
  assert.deepEqual(ARENA_ROUTE.models.map((model) => model.name), EXPECTED_NAMES)
  assert.deepEqual(ARENA_ROUTE.models[0].input, ['text', 'image'])
  assert.equal(ARENA_ROUTE.models[0].contextWindow, 1000000)
  assert.equal(ARENA_ROUTE.models[0].maxTokens, 128000)
})

test('route state distinguishes missing, declared, and malformed configuration', () => {
  assert.equal(arenaRouteState(undefined), 'missing')
  assert.equal(arenaRouteState({}), 'missing')
  assert.equal(arenaRouteState({ providers: {} }), 'missing')
  assert.equal(arenaRouteState({ providers: { arena: {} } }), 'declared')
  assert.equal(arenaRouteState(null), 'unusable')
  assert.equal(arenaRouteState({ providers: [] }), 'unusable')
})

test('route merge is additive and respects a user-defined Arena route', () => {
  const other = { displayName: 'Other' }
  const merged = withArenaRoute({ providers: { other } })
  assert.strictEqual(merged.providers.other, other)
  assert.deepEqual(merged.providers.arena, ARENA_ROUTE)
  assert.notStrictEqual(merged.providers.arena, ARENA_ROUTE)

  const userArena = { displayName: 'User Arena', models: [{ id: 'custom' }] }
  const declared = { providers: { arena: userArena } }
  assert.strictEqual(withArenaRoute(declared), declared)

  const malformed = { providers: [] }
  assert.strictEqual(withArenaRoute(malformed), malformed)
})

test('initial claim updates a missing route once', async () => {
  let updated
  const entry = {
    options: { id: PI_AI_ENTRY.id, name: PI_AI_ENTRY.name, config: undefined },
    async update(value) {
      updated = value
    },
  }
  const ctx = { get: (name) => (name === 'loader' ? { entries: () => [entry] } : undefined) }
  assert.equal(await claimArenaRoute(ctx), 'claimed')
  assert.deepEqual(updated.config.providers.arena, ARENA_ROUTE)
})

test('initial claim never overwrites an explicit user route', async () => {
  let updates = 0
  const userArena = { displayName: 'User Arena' }
  const entry = {
    options: { id: PI_AI_ENTRY.id, name: PI_AI_ENTRY.name, config: { providers: { arena: userArena } } },
    async update() {
      updates += 1
    },
  }
  const ctx = { get: () => ({ entries: () => [entry] }) }
  assert.equal(await claimArenaRoute(ctx), 'declared')
  assert.equal(updates, 0)
})

test('resolution hook targets only llm-pi-ai and preserves other providers', () => {
  let handler
  const ctx = {
    on(event, value, options) {
      assert.equal(event, 'internal/config')
      assert.deepEqual(options, { global: true })
      handler = value
      return () => {}
    },
  }
  watchArenaRoute(ctx)
  const resolved = { providers: { other: { displayName: 'Other' } } }
  const target = handler.call({ entry: { options: PI_AI_ENTRY } }, undefined, () => resolved)
  assert.deepEqual(target.providers.other, resolved.providers.other)
  assert.deepEqual(target.providers.arena, ARENA_ROUTE)

  const repeated = handler.call({ entry: { options: PI_AI_ENTRY } }, undefined, () => target)
  assert.strictEqual(repeated, target)

  const untouched = handler.call({ entry: { options: { id: 'different', name: 'different' } } }, undefined, () => resolved)
  assert.strictEqual(untouched, resolved)
})
