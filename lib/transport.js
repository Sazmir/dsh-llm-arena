import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const ARENA_HOST = 'api.arena.ai'
const ARENA_ORIGIN = `https://${ARENA_HOST}`
const MAX_CHALLENGE_PREFIX_BYTES = 64 * 1024
const MAX_REQUEST_BODY_BYTES = 64 * 1024 * 1024
const MAX_STDERR_BYTES = 64 * 1024
const CHILD_ENV_ALLOWLIST = new Set([
  'comspec',
  'dotnet_root',
  'localappdata',
  'path',
  'pathext',
  'processor_architecture',
  'psmodulepath',
  'systemroot',
  'temp',
  'term',
  'tmp',
  'windir',
])
const NULL_BODY_STATUSES = new Set([204, 205, 304])
const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308])
const helperPath = fileURLToPath(new URL('./invoke-arena.ps1', import.meta.url))

function urlOf(input) {
  try {
    if (typeof input === 'string') return new URL(input)
    if (input instanceof URL) return new URL(input.href)
    if (typeof Request === 'function' && input instanceof Request) return new URL(input.url)
  } catch {
    return undefined
  }
  return undefined
}

function isArenaOrigin(url) {
  return url.protocol === 'https:' && url.origin.toLowerCase() === ARENA_ORIGIN
}

function normalizedRequest(input, init) {
  if (typeof Request === 'function' && input instanceof Request && init === undefined) return input.clone()
  const explicitBody = init !== undefined && Object.hasOwn(init, 'body') && init.body !== null && init.body !== undefined
  const normalizedInit = explicitBody && init.duplex === undefined ? { ...init, duplex: 'half' } : init
  return new Request(input, normalizedInit)
}

async function readRequestBody(request, maxBytes = MAX_REQUEST_BODY_BYTES) {
  if (request.body === null) return undefined
  const signal = request.signal
  if (signal.aborted) throw abortError(signal.reason)

  const reader = request.body.getReader()
  const chunks = []
  let total = 0
  const onAbort = () => {
    reader.cancel(signal.reason).catch(() => {})
  }
  signal.addEventListener('abort', onAbort, { once: true })
  try {
    while (true) {
      const result = await reader.read()
      if (signal.aborted) throw abortError(signal.reason)
      if (result.done) break
      const chunk = Buffer.from(result.value)
      total += chunk.length
      if (total > maxBytes) {
        const error = new RangeError(`dsh-llm-arena: request body exceeds ${maxBytes} bytes`)
        await reader.cancel(error).catch(() => {})
        throw error
      }
      chunks.push(chunk)
    }
    return Buffer.concat(chunks, total)
  } finally {
    signal.removeEventListener('abort', onAbort)
    try {
      reader.releaseLock()
    } catch {
      // A cancelled reader may already have released its lock.
    }
  }
}

async function snapshotRequest(request, maxBodyBytes) {
  const url = new URL(request.url)
  if (!isArenaOrigin(url)) throw new TypeError(`dsh-llm-arena: normalized request escaped Arena origin: ${url.origin}`)
  return {
    url: url.href,
    method: request.method,
    headers: Object.fromEntries(request.headers.entries()),
    body: await readRequestBody(request, maxBodyBytes),
    signal: request.signal,
    redirect: request.redirect,
  }
}

function nativeRequest(snapshot) {
  return new Request(snapshot.url, {
    method: snapshot.method,
    headers: snapshot.headers,
    body: snapshot.body,
    signal: snapshot.signal,
    redirect: snapshot.redirect,
    ...(snapshot.body === undefined ? {} : { duplex: 'half' }),
  })
}

function abortError(reason) {
  if (reason instanceof Error) return reason
  return new DOMException(typeof reason === 'string' ? reason : 'The operation was aborted', 'AbortError')
}

function redactErrorText(value) {
  return String(value)
    .replace(/Bearer\s+[A-Za-z0-9._~+\/-]+=*/gi, 'Bearer [REDACTED]')
    .replace(/\b(?:sk|key|token)-[A-Za-z0-9._-]{8,}\b/gi, '[REDACTED]')
}

function helperError(message, stderr) {
  const detail = redactErrorText(Buffer.concat(stderr).toString('utf8').trim())
  const safeMessage = redactErrorText(message)
  return new Error(`dsh-llm-arena: ${safeMessage}${detail ? `: ${detail}` : ''}`)
}

export function sanitizedChildEnv(source = process.env) {
  const env = { POWERSHELL_TELEMETRY_OPTOUT: '1' }
  for (const [name, value] of Object.entries(source)) {
    if (value === undefined || !CHILD_ENV_ALLOWLIST.has(name.toLowerCase())) continue
    env[name] = value
  }
  return env
}

function decodeProtocolLine(line) {
  const separator = line.indexOf(' ')
  if (separator < 0) throw new Error('helper returned a malformed protocol line')
  const marker = line.slice(0, separator)
  const encoded = line.slice(separator + 1)
  const payload = JSON.parse(Buffer.from(encoded, 'base64').toString('utf8'))
  return { marker, payload }
}

export function invokePowerShell(payload, signal, executable = 'pwsh') {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(abortError(signal.reason))
      return
    }

    const child = spawn(executable, ['-NoLogo', '-NoProfile', '-NonInteractive', '-File', helperPath], {
      windowsHide: true,
      stdio: ['pipe', 'pipe', 'pipe'],
      env: sanitizedChildEnv(),
    })
    const stderr = []
    let stderrBytes = 0
    let prefix = Buffer.alloc(0)
    let metadataSeen = false
    let promiseSettled = false
    let processClosed = false
    let stdoutPaused = false
    let consumerCancelled = false
    let controller

    const body = new ReadableStream({
      start(value) {
        controller = value
      },
      pull() {
        if (stdoutPaused && !processClosed) {
          stdoutPaused = false
          child.stdout.resume()
        }
      },
      cancel() {
        consumerCancelled = true
        if (!processClosed) child.kill()
      },
    })

    const settlePromise = (callback, value) => {
      if (promiseSettled) return
      promiseSettled = true
      callback(value)
    }
    const enqueue = (chunk) => {
      if (consumerCancelled) return false
      try {
        controller.enqueue(new Uint8Array(chunk))
        if ((controller.desiredSize ?? 1) <= 0 && !stdoutPaused && !processClosed) {
          stdoutPaused = true
          child.stdout.pause()
        }
        return true
      } catch {
        consumerCancelled = true
        if (!processClosed) child.kill()
        return false
      }
    }
    const errorStream = (error) => {
      if (consumerCancelled) return
      try {
        controller.error(error)
      } catch {
        // The consumer may already have cancelled the stream.
      }
    }
    const closeStream = () => {
      if (consumerCancelled) return
      try {
        controller.close()
      } catch {
        // The consumer may already have cancelled the stream.
      }
    }
    const fail = (error) => {
      if (metadataSeen) errorStream(error)
      else settlePromise(reject, error)
    }
    const onAbort = () => {
      const error = abortError(signal.reason)
      if (!processClosed) child.kill()
      fail(error)
    }
    signal?.addEventListener('abort', onAbort, { once: true })

    child.stderr.on('data', (chunk) => {
      if (stderrBytes >= MAX_STDERR_BYTES) return
      const remaining = MAX_STDERR_BYTES - stderrBytes
      const kept = chunk.length > remaining ? chunk.subarray(0, remaining) : chunk
      stderr.push(kept)
      stderrBytes += kept.length
    })
    child.stdout.on('data', (chunk) => {
      if (metadataSeen) {
        enqueue(chunk)
        return
      }

      prefix = Buffer.concat([prefix, chunk])
      const newline = prefix.indexOf(0x0a)
      if (newline < 0) {
        if (prefix.length > 1024 * 1024) {
          child.kill()
          fail(helperError('helper metadata exceeded 1 MiB', stderr))
        }
        return
      }

      const line = prefix.subarray(0, newline).toString('ascii').replace(/\r$/, '')
      const remainder = prefix.subarray(newline + 1)
      prefix = Buffer.alloc(0)
      let decoded
      try {
        decoded = decodeProtocolLine(line)
      } catch (error) {
        child.kill()
        fail(helperError(error.message, stderr))
        return
      }
      if (decoded.marker === 'ARENAERROR/1') {
        child.kill()
        fail(helperError(decoded.payload.error ?? 'helper failed', stderr))
        return
      }
      if (decoded.marker !== 'ARENAHTTP/1') {
        child.kill()
        fail(helperError(`unknown helper marker ${decoded.marker}`, stderr))
        return
      }

      metadataSeen = true
      settlePromise(resolve, { ...decoded.payload, body })
      if (remainder.length > 0) enqueue(remainder)
    })
    child.on('error', (error) => {
      processClosed = true
      signal?.removeEventListener('abort', onAbort)
      if (error?.code === 'ENOENT') {
        fail(new Error(`dsh-llm-arena: PowerShell 7 executable "${executable}" was not found; install pwsh or fix PATH`))
        return
      }
      fail(error)
    })
    child.on('close', (code) => {
      processClosed = true
      signal?.removeEventListener('abort', onAbort)
      if (!metadataSeen) {
        fail(helperError(`helper exited ${code ?? 'without a status'} before response metadata`, stderr))
        return
      }
      if (code === 0) closeStream()
      else errorStream(helperError(`helper exited ${code ?? 'without a status'}`, stderr))
    })

    child.stdin.on('error', (error) => {
      if (!processClosed) child.kill()
      fail(error)
    })
    child.stdin.end(JSON.stringify(payload))
  })
}

async function readResponsePrefix(response, limit = MAX_CHALLENGE_PREFIX_BYTES) {
  if (response.body === null) return ''
  const reader = response.body.getReader()
  const chunks = []
  let total = 0
  try {
    while (total < limit) {
      const result = await reader.read()
      if (result.done) break
      const remaining = limit - total
      const chunk = Buffer.from(result.value)
      const kept = chunk.length > remaining ? chunk.subarray(0, remaining) : chunk
      chunks.push(kept)
      total += kept.length
      if (chunk.length > remaining) break
    }
  } finally {
    reader.cancel().catch(() => {})
  }
  return Buffer.concat(chunks, total).toString('utf8')
}

export async function isCloudflareChallenge(response) {
  if (response.status !== 403) return false
  const type = (response.headers.get('content-type') ?? '').toLowerCase()
  if (!type.includes('text/html')) return false
  const server = (response.headers.get('server') ?? '').toLowerCase()
  const ray = response.headers.get('cf-ray')
  if (!server.includes('cloudflare') || ray === null || ray.trim() === '') return false
  let prefix
  try {
    prefix = await readResponsePrefix(response.clone())
  } catch {
    return false
  }
  return /attention required|cf-error-details|performance\s*&amp;\s*security by cloudflare/i.test(prefix)
}

function annotateResponse(response, url) {
  try {
    Object.defineProperties(response, {
      url: { value: url, configurable: true },
      redirected: { value: false, configurable: true },
    })
  } catch {
    // The standard body/status/headers behavior is sufficient if the runtime
    // does not permit own properties over the built-in accessors.
  }
  return response
}

async function powershellResponse(snapshot, invoke) {
  const envelope = await invoke({
    url: snapshot.url,
    method: snapshot.method,
    headers: snapshot.headers,
    bodyBase64: snapshot.body?.toString('base64'),
  }, snapshot.signal)

  if (REDIRECT_STATUSES.has(envelope.status) && snapshot.redirect !== 'manual') {
    await envelope.body.cancel('dsh-llm-arena refuses credential-bearing redirects')
    throw new TypeError(`dsh-llm-arena: Arena returned redirect ${envelope.status}; refusing to forward credentials`)
  }

  const responseInit = {
    status: envelope.status,
    statusText: envelope.statusText,
    headers: envelope.headers,
  }
  if (NULL_BODY_STATUSES.has(envelope.status)) {
    await envelope.body.cancel('response status has no body')
    return annotateResponse(new Response(null, responseInit), snapshot.url)
  }
  return annotateResponse(new Response(envelope.body, responseInit), snapshot.url)
}

export function createArenaFetch(native, options = {}) {
  const platform = options.platform ?? process.platform
  const mode = options.mode ?? 'auto'
  if (!['auto', 'native', 'powershell'].includes(mode)) {
    throw new TypeError(`dsh-llm-arena: unsupported transport mode ${mode}`)
  }
  const invoke = options.invoke ?? ((payload, signal) => invokePowerShell(payload, signal, options.executable ?? 'pwsh'))
  const maxRequestBodyBytes = options.maxRequestBodyBytes ?? MAX_REQUEST_BODY_BYTES
  if (!Number.isSafeInteger(maxRequestBodyBytes) || maxRequestBodyBytes < 1) {
    throw new TypeError('dsh-llm-arena: maxRequestBodyBytes must be a positive safe integer')
  }
  const onFallback = options.onFallback

  return async function arenaFetch(input, init) {
    const initialURL = urlOf(input)
    if (initialURL === undefined) return native(input, init)
    if (initialURL.hostname.toLowerCase() !== ARENA_HOST) return native(input, init)
    if (!isArenaOrigin(initialURL)) throw new TypeError(`dsh-llm-arena: refusing non-canonical Arena origin ${initialURL.origin}`)

    const request = normalizedRequest(input, init)
    const snapshot = await snapshotRequest(request, maxRequestBodyBytes)

    if (mode !== 'powershell') {
      const nativeResponse = await native(nativeRequest(snapshot))
      if (mode === 'native' || platform !== 'win32' || !(await isCloudflareChallenge(nativeResponse))) {
        return nativeResponse
      }
      await nativeResponse.body?.cancel().catch(() => {})
      onFallback?.()
    }

    return powershellResponse(snapshot, invoke)
  }
}
