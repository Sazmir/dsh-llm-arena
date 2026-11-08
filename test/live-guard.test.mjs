import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import path from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const script = path.join(root, 'scripts', 'live-smoke.mjs')

function run(env) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [script], {
      env,
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    const stdout = []
    const stderr = []
    child.stdout.on('data', (chunk) => stdout.push(chunk))
    child.stderr.on('data', (chunk) => stderr.push(chunk))
    child.on('error', reject)
    child.on('close', (code) => resolve({
      code,
      stdout: Buffer.concat(stdout).toString('utf8'),
      stderr: Buffer.concat(stderr).toString('utf8'),
    }))
  })
}

function minimalEnv(extra = {}) {
  const env = { ...extra }
  for (const name of ['PATH', 'Path', 'SystemRoot', 'WINDIR', 'PATHEXT', 'HOME', 'TMP', 'TEMP']) {
    if (process.env[name] !== undefined) env[name] = process.env[name]
  }
  return env
}

test('live smoke refuses without explicit opt-in', async () => {
  const result = await run(minimalEnv())
  assert.equal(result.code, 2)
  assert.match(result.stderr, /ARENA_LIVE_SMOKE=1/)
})

test('ambient key alone is never consent for a live call', async () => {
  const result = await run(minimalEnv({ ARENA_API_KEY: 'fixture-only' }))
  assert.equal(result.code, 2)
  assert.match(result.stderr, /ARENA_LIVE_SMOKE=1/)
})
