export const ARENA_PROVIDER = 'arena'
export const PI_AI_ENTRY = Object.freeze({ id: 'llm-pi-ai', name: '@deepseek-ai/dsh-llm-pi-ai' })

const MODELS = [
  {
    id: 'coding-router-preview',
    name: 'Arena Router · Coding (promo)',
    contextWindow: 1000000,
    maxTokens: 128000,
    input: Object.freeze(['text', 'image']),
  },
  { id: 'claude-coding-router-preview', name: 'Arena Router · Claude (promo)' },
  { id: 'claude-fable-5-1', name: 'All models · Claude Fable 5.1' },
  { id: 'claude-opus-5-5', name: 'All models · Claude Opus 5.5' },
  { id: 'claude-sonnet-5-5', name: 'All models · Claude Sonnet 5.5' },
  { id: 'claude-haiku-5-5', name: 'All models · Claude Haiku 5.5' },
].map((model) => Object.freeze(model))

export const ARENA_ROUTE = Object.freeze({
  displayName: 'Arena API',
  apiKeyEnv: 'ARENA_API_KEY',
  api: 'openai-responses',
  baseURL: 'https://api.arena.ai/v1',
  defaultContextWindow: 262144,
  defaultMaxTokens: 32768,
  defaultInput: Object.freeze(['text']),
  cacheRetention: 'none',
  compat: Object.freeze({
    supportsDeveloperRole: false,
    supportsStrictMode: true,
    supportsLongCacheRetention: false,
  }),
  models: Object.freeze(MODELS),
})
