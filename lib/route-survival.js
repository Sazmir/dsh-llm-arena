import { ARENA_PROVIDER, ARENA_ROUTE, PI_AI_ENTRY } from './route.js'

export function arenaRouteState(config) {
  if (config === undefined) return 'missing'
  if (typeof config !== 'object' || config === null || Array.isArray(config)) return 'unusable'
  const providers = config.providers
  if (providers === undefined) return 'missing'
  if (typeof providers !== 'object' || providers === null || Array.isArray(providers)) return 'unusable'
  return providers[ARENA_PROVIDER] === undefined ? 'missing' : 'declared'
}

export function withArenaRoute(config) {
  if (arenaRouteState(config) !== 'missing') return config
  const providers = typeof config?.providers === 'object' && config.providers !== null ? config.providers : {}
  return {
    ...(config ?? {}),
    providers: {
      ...providers,
      [ARENA_PROVIDER]: structuredClone(ARENA_ROUTE),
    },
  }
}

export function watchArenaRoute(ctx) {
  if (typeof ctx.on !== 'function') return () => {}
  return ctx.on(
    'internal/config',
    function (_config, next) {
      const resolved = next()
      const entry = this?.entry
      if (entry?.options?.id !== PI_AI_ENTRY.id || entry.options.name !== PI_AI_ENTRY.name) return resolved
      return withArenaRoute(resolved)
    },
    { global: true },
  )
}

export async function claimArenaRoute(ctx) {
  const loader = ctx.get('loader')
  if (loader === undefined) return 'absent'
  const entry = [...loader.entries()].find(
    (row) => row.options.id === PI_AI_ENTRY.id && row.options.name === PI_AI_ENTRY.name,
  )
  if (entry === undefined) return 'absent'
  const state = arenaRouteState(entry.options.config)
  if (state !== 'missing') return state
  try {
    await entry.update({ config: withArenaRoute(entry.options.config) })
  } catch {
    return 'failed'
  }
  return 'claimed'
}
