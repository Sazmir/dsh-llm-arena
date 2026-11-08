import { claimArenaRoute, watchArenaRoute } from './route-survival.js'
import { createArenaFetch } from './transport.js'

export const name = 'llm-arena'

function installRouteSurvival(ctx) {
  if (typeof ctx.inject !== 'function') return
  ctx.inject(['loader'], (scoped) => {
    scoped.effect(() => watchArenaRoute(scoped), 'dsh-llm-arena: route resolution hook')
    scoped.effect(() => {
      let cancelled = false
      claimArenaRoute(scoped).then(
        (outcome) => {
          if (cancelled) return
          if (outcome === 'claimed') {
            ctx.logger.info('profile providers omitted Arena; restored the default Arena route in memory')
          } else if (outcome === 'failed') {
            ctx.logger.warn('profile providers omitted Arena and the route could not be restored')
          } else if (outcome === 'absent') {
            ctx.logger.warn('llm-pi-ai is absent; the Arena route cannot be registered')
          } else if (outcome === 'unusable') {
            ctx.logger.warn('llm-pi-ai providers configuration is malformed; Arena left untouched')
          }
        },
        (error) => ctx.logger.warn('Arena route restoration failed', error),
      )
      return () => {
        cancelled = true
      }
    })
  })
}

function installWindowsFallback(ctx) {
  if (process.platform !== 'win32') return
  ctx.effect(() => {
    const previous = globalThis.fetch
    if (typeof previous !== 'function') {
      ctx.logger.warn('global fetch is unavailable; Arena requests cannot be wrapped')
      return () => {}
    }
    let fallbackReported = false
    const wrapped = createArenaFetch(previous, {
      platform: process.platform,
      onFallback: () => {
        if (fallbackReported) return
        fallbackReported = true
        ctx.logger.warn('native Arena transport hit a Cloudflare challenge; retrying affected requests through PowerShell/.NET')
      },
    })
    globalThis.fetch = wrapped
    return () => {
      if (globalThis.fetch === wrapped) globalThis.fetch = previous
    }
  })
}

export function apply(ctx) {
  installRouteSurvival(ctx)
  installWindowsFallback(ctx)
}
