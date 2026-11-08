import assert from 'node:assert/strict'
import test from 'node:test'
import {
  createArenaFetch,
  isCloudflareChallenge,
  sanitizedChildEnv,
} from '../lib/transport.js'

function envelope(body = 'fallback', status = 200, headers = { 'content-type': 'text/plain' }) {
  return {
    status,
    statusText: status === 200 ? 'OK' : 'Error',
    headers,
    body: new Response(body).body,
  }
}

function cloudflareResponse(overrides = {}) {
  return new Response('<!doctype html><title>Attention Required!</title><div id="cf-error-details">Cloudflare</div>', {
    status: 403,
    headers: {
      'content-type': 'text/html; charset=UTF-8',
      server: 'cloudflare',
      'cf-ray': 'test-ray',
      ...overrides,
    },
  })
}

test('unsupported transport modes fail during construction', () => {
  assert.throws(() => createArenaFetch(fetch, { mode: 'unexpected' }), /unsupported transport mode/)
})

test('non-Arena origins delegate untouched', async () => {
  let calls = 0
  const native = async (input, init) => {
    calls += 1
    assert.equal(input, 'https://example.com/test')
    assert.deepEqual(init, { method: 'GET' })
    return new Response('native', { status: 201 })
  }
  const response = await createArenaFetch(native)('https://example.com/test', { method: 'GET' })
  assert.equal(calls, 1)
  assert.equal(response.status, 201)
  assert.equal(await response.text(), 'native')
})

test('noncanonical Arena origins fail closed', async () => {
  const wrapped = createArenaFetch(async () => new Response('unexpected'))
  await assert.rejects(() => wrapped('http://api.arena.ai/v1/models'), /non-canonical Arena origin/)
  await assert.rejects(() => wrapped('https://api.arena.ai:444/v1/models'), /non-canonical Arena origin/)
})

test('native success stays native and makes no helper call', async () => {
  let helperCalls = 0
  const native = async (request) => {
    assert.equal(request.url, 'https://api.arena.ai/v1/models')
    return new Response('{"data":[]}', { status: 200, headers: { 'content-type': 'application/json' } })
  }
  const wrapped = createArenaFetch(native, {
    platform: 'win32',
    invoke: async () => {
      helperCalls += 1
      return envelope()
    },
  })
  const response = await wrapped('https://api.arena.ai/v1/models')
  assert.equal(response.status, 200)
  assert.equal(helperCalls, 0)
})

test('401 and Cloudflare 429 do not trigger fallback', async (context) => {
  for (const status of [401, 429]) {
    await context.test(String(status), async () => {
      let helperCalls = 0
      const wrapped = createArenaFetch(
        async () => new Response('denied', {
          status,
          headers: { 'content-type': 'text/html', server: 'cloudflare', 'cf-ray': 'ray' },
        }),
        {
          platform: 'win32',
          invoke: async () => {
            helperCalls += 1
            return envelope()
          },
        },
      )
      const response = await wrapped('https://api.arena.ai/v1/models')
      assert.equal(response.status, status)
      assert.equal(helperCalls, 0)
    })
  }
})

test('native transport failures propagate without replay', async () => {
  let helperCalls = 0
  const expected = new Error('native transport failed')
  const wrapped = createArenaFetch(async () => { throw expected }, {
    platform: 'win32',
    invoke: async () => {
      helperCalls += 1
      return envelope()
    },
  })
  await assert.rejects(() => wrapped('https://api.arena.ai/v1/models'), expected)
  assert.equal(helperCalls, 0)
})

test('ordinary Arena 403 does not trigger fallback', async () => {
  let helperCalls = 0
  const wrapped = createArenaFetch(
    async () => new Response('{"error":"forbidden"}', {
      status: 403,
      headers: { 'content-type': 'application/json', server: 'cloudflare', 'cf-ray': 'ray' },
    }),
    {
      platform: 'win32',
      invoke: async () => {
        helperCalls += 1
        return envelope()
      },
    },
  )
  const response = await wrapped('https://api.arena.ai/v1/models')
  assert.equal(response.status, 403)
  assert.equal(helperCalls, 0)
  assert.equal(await response.text(), '{"error":"forbidden"}')
})

test('challenge classifier requires status, HTML, both Cloudflare headers, and marker', async () => {
  assert.equal(await isCloudflareChallenge(cloudflareResponse()), true)
  assert.equal(await isCloudflareChallenge(cloudflareResponse({ server: 'nginx' })), false)
  assert.equal(await isCloudflareChallenge(cloudflareResponse({ 'cf-ray': '' })), false)
  assert.equal(await isCloudflareChallenge(new Response('Cloudflare', {
    status: 403,
    headers: { 'content-type': 'text/plain', server: 'cloudflare', 'cf-ray': 'ray' },
  })), false)
  assert.equal(await isCloudflareChallenge(new Response('<html>ordinary denial</html>', {
    status: 403,
    headers: { 'content-type': 'text/html', server: 'cloudflare', 'cf-ray': 'ray' },
  })), false)
})

test('challenge sniff is bounded and does not hang on a large cloned body', async () => {
  const large = '<div id="cf-error-details">Attention Required</div>' + 'x'.repeat(128 * 1024)
  const check = isCloudflareChallenge(new Response(large, {
    status: 403,
    headers: { 'content-type': 'text/html', server: 'cloudflare', 'cf-ray': 'ray' },
  }))
  const result = await Promise.race([
    check,
    new Promise((_, reject) => setTimeout(() => reject(new Error('classifier timed out')), 1000)),
  ])
  assert.equal(result, true)
})

test('challenge sniff failures are treated as ordinary 403 responses', async () => {
  const body = new ReadableStream({
    start(controller) {
      controller.error(new Error('fixture read failure'))
    },
  })
  const response = new Response(body, {
    status: 403,
    headers: { 'content-type': 'text/html', server: 'cloudflare', 'cf-ray': 'ray' },
  })
  assert.equal(await isCloudflareChallenge(response), false)
})

test('recognized challenge replays only the affected request', async () => {
  let nativeCalls = 0
  let helperCalls = 0
  let fallbackEvents = 0
  const payloads = []
  const wrapped = createArenaFetch(
    async () => {
      nativeCalls += 1
      if (nativeCalls === 1) return cloudflareResponse()
      return new Response('native-recovered', { status: 200 })
    },
    {
      platform: 'win32',
      onFallback: () => {
        fallbackEvents += 1
      },
      invoke: async (payload) => {
        helperCalls += 1
        payloads.push(payload)
        return envelope('fallback-1')
      },
    },
  )

  const first = await wrapped('https://api.arena.ai/v1/responses', {
    method: 'POST',
    headers: { authorization: 'Bearer test', 'content-type': 'application/json' },
    body: '{"model":"coding-router-preview"}',
  })
  assert.equal(await first.text(), 'fallback-1')
  const second = await wrapped('https://api.arena.ai/v1/models')
  assert.equal(await second.text(), 'native-recovered')

  assert.equal(nativeCalls, 2)
  assert.equal(helperCalls, 1)
  assert.equal(fallbackEvents, 1)
  assert.equal(Buffer.from(payloads[0].bodyBase64, 'base64').toString('utf8'), '{"model":"coding-router-preview"}')
  assert.equal(payloads[0].headers.authorization, 'Bearer test')
})

test('request URL is snapshotted before asynchronous body work', async () => {
  let sentURL
  const wrapped = createArenaFetch(async () => cloudflareResponse(), {
    platform: 'win32',
    invoke: async (payload) => {
      sentURL = payload.url
      return envelope()
    },
  })
  const mutable = new URL('https://api.arena.ai/v1/models')
  const pending = wrapped(mutable)
  mutable.href = 'http://127.0.0.1:9/leak'
  await pending
  assert.equal(sentURL, 'https://api.arena.ai/v1/models')
})

test('RequestInit headers replace inherited Request headers', async () => {
  let sentHeaders
  const wrapped = createArenaFetch(async () => cloudflareResponse(), {
    platform: 'win32',
    invoke: async (payload) => {
      sentHeaders = payload.headers
      return envelope()
    },
  })
  const input = new Request('https://api.arena.ai/v1/models', {
    headers: { authorization: 'Bearer inherited', 'x-old': '1' },
  })
  await wrapped(input, { headers: { 'x-new': '2' } })
  assert.equal(sentHeaders.authorization, undefined)
  assert.equal(sentHeaders['x-old'], undefined)
  assert.equal(sentHeaders['x-new'], '2')
})

test('upload abort cancels the source before invoking the helper', async () => {
  let cancelCalled = false
  let invokeCalls = 0
  let timer
  const body = new ReadableStream({
    start(controller) {
      timer = setInterval(() => controller.enqueue(new Uint8Array(64)), 5)
    },
    cancel() {
      cancelCalled = true
      clearInterval(timer)
    },
  })
  const controller = new AbortController()
  const wrapped = createArenaFetch(async () => cloudflareResponse(), {
    mode: 'powershell',
    platform: 'win32',
    invoke: async () => {
      invokeCalls += 1
      return envelope()
    },
  })
  const pending = wrapped('https://api.arena.ai/v1/responses', {
    method: 'POST',
    body,
    signal: controller.signal,
  })
  setTimeout(() => controller.abort('test abort'), 20)
  await assert.rejects(() => pending, { name: 'AbortError' })
  assert.equal(cancelCalled, true)
  assert.equal(invokeCalls, 0)
})

test('request body cap fails before transport invocation', async () => {
  let invokeCalls = 0
  const wrapped = createArenaFetch(async () => cloudflareResponse(), {
    mode: 'powershell',
    platform: 'win32',
    maxRequestBodyBytes: 10,
    invoke: async () => {
      invokeCalls += 1
      return envelope()
    },
  })
  await assert.rejects(
    () => wrapped('https://api.arena.ai/v1/responses', { method: 'POST', body: '12345678901' }),
    /request body exceeds 10 bytes/,
  )
  assert.equal(invokeCalls, 0)
})

test('credential-bearing redirects fail closed', async () => {
  const wrapped = createArenaFetch(async () => cloudflareResponse(), {
    mode: 'powershell',
    platform: 'win32',
    invoke: async () => envelope('', 302, { location: 'https://example.com/' }),
  })
  await assert.rejects(() => wrapped('https://api.arena.ai/v1/models'), /refusing to forward credentials/)
})

test('missing PowerShell 7 produces an actionable error', async () => {
  const wrapped = createArenaFetch(async () => cloudflareResponse(), {
    mode: 'powershell',
    platform: 'win32',
    executable: 'pwsh-command-that-does-not-exist',
  })
  await assert.rejects(
    () => wrapped('https://api.arena.ai/v1/models'),
    /PowerShell 7 executable .* was not found/,
  )
})

test('PowerShell child environment excludes ambient credentials and proxy secrets', () => {
  const env = sanitizedChildEnv({
    Path: 'C:\\Windows',
    SystemRoot: 'C:\\Windows',
    ARENA_API_KEY: 'secret',
    AGENTROUTER_API_KEY: 'secret-2',
    HTTPS_PROXY: 'http://user:password@example.com',
  })
  assert.equal(env.Path, 'C:\\Windows')
  assert.equal(env.SystemRoot, 'C:\\Windows')
  assert.equal(env.ARENA_API_KEY, undefined)
  assert.equal(env.AGENTROUTER_API_KEY, undefined)
  assert.equal(env.HTTPS_PROXY, undefined)
  assert.equal(env.POWERSHELL_TELEMETRY_OPTOUT, '1')
})
