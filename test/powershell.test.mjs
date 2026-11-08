import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import path from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'
import { sanitizedChildEnv } from '../lib/transport.js'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const helper = path.join(root, 'lib', 'invoke-arena.ps1')

function runPwsh(args, input = '') {
  return new Promise((resolve, reject) => {
    const child = spawn('pwsh', args, {
      windowsHide: true,
      env: sanitizedChildEnv(),
      stdio: ['pipe', 'pipe', 'pipe'],
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
    child.stdin.end(input)
  })
}

test('Windows fallback requires PowerShell 7', { skip: process.platform !== 'win32' }, async () => {
  const result = await runPwsh(['-NoLogo', '-NoProfile', '-NonInteractive', '-Command', '$PSVersionTable.PSVersion.Major'])
  assert.equal(result.code, 0)
  assert.ok(Number(result.stdout.trim()) >= 7, `expected PowerShell 7+, got ${result.stdout.trim()}`)
})

test('PowerShell helper refuses noncanonical origins without echoing credentials', { skip: process.platform !== 'win32' }, async () => {
  const sentinel = 'Bearer TEST_CREDENTIAL_MUST_NOT_APPEAR'
  const request = JSON.stringify({
    url: 'http://127.0.0.1/not-arena',
    method: 'GET',
    headers: { authorization: sentinel },
  })
  const result = await runPwsh(['-NoLogo', '-NoProfile', '-NonInteractive', '-File', helper], request)
  assert.equal(result.code, 1)
  assert.match(result.stdout, /^ARENAERROR\/1 /)
  const encoded = result.stdout.trim().slice('ARENAERROR/1 '.length)
  const payload = JSON.parse(Buffer.from(encoded, 'base64').toString('utf8'))
  assert.match(payload.error, /Refusing non-canonical Arena origin/)
  assert.doesNotMatch(result.stdout, /TEST_CREDENTIAL_MUST_NOT_APPEAR/)
  assert.doesNotMatch(result.stderr, /TEST_CREDENTIAL_MUST_NOT_APPEAR/)
})
