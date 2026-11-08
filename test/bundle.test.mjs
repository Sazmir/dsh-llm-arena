import assert from 'node:assert/strict'
import { readFile, readdir } from 'node:fs/promises'
import path from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

async function filesBelow(directory) {
  const entries = await readdir(directory, { withFileTypes: true })
  const files = []
  for (const entry of entries) {
    if (entry.name === '.git' || entry.name === 'node_modules') continue
    const full = path.join(directory, entry.name)
    if (entry.isDirectory()) files.push(...await filesBelow(full))
    else files.push(full)
  }
  return files
}

test('bundle patch inserts only the runtime plugin', async () => {
  const document = await readFile(path.join(root, 'cordis.patch.yml'), 'utf8')
  assert.match(document, /- insert:\r?\n\s+- id: llm-arena\r?\n\s+name: dsh-llm-arena/)
  assert.doesNotMatch(document, /id:\s*llm-pi-ai/)
  assert.doesNotMatch(document, /providers:/)
})

test('package metadata points at the public repository and bundle patch', async () => {
  const pkg = JSON.parse(await readFile(path.join(root, 'package.json'), 'utf8'))
  assert.equal(pkg.name, 'dsh-llm-arena')
  assert.equal(pkg.version, '0.1.1')
  assert.match(pkg.description, /promotional Arena Router credits/)
  assert.match(pkg.meta.description, /All models balance/)
  assert.equal(pkg.license, 'MIT')
  assert.equal(pkg.private, undefined)
  assert.equal(pkg.dsh.bundle.patch, './cordis.patch.yml')
  assert.equal(pkg.repository.url, 'git+https://github.com/Sazmir/dsh-llm-arena.git')
  for (const required of ['lib/', 'scripts/live-smoke.mjs', 'cordis.patch.yml', 'README.md', 'README.ru.md', 'AGENTS.md', 'SECURITY.md', 'LICENSE']) {
    assert.ok(pkg.files.includes(required), `package files must include ${required}`)
  }
})

test('English and Russian READMEs keep model and command parity', async () => {
  const english = await readFile(path.join(root, 'README.md'), 'utf8')
  const russian = await readFile(path.join(root, 'README.ru.md'), 'utf8')
  const modelIds = [
    'coding-router-preview',
    'claude-coding-router-preview',
    'claude-fable-5-1',
    'claude-opus-5-5',
    'claude-sonnet-5-5',
    'claude-haiku-5-5',
  ]
  for (const id of modelIds) {
    assert.ok(english.includes(`\`${id}\``), `English README misses ${id}`)
    assert.ok(russian.includes(`\`${id}\``), `Russian README misses ${id}`)
  }
  for (const label of [
    'Arena Router · Coding (promo)',
    'Arena Router · Claude (promo)',
    'All models · Claude Fable 5.1',
    'All models · Claude Opus 5.5',
    'All models · Claude Sonnet 5.5',
    'All models · Claude Haiku 5.5',
  ]) {
    assert.ok(english.includes(label), `English README misses ${label}`)
    assert.ok(russian.includes(label), `Russian README misses ${label}`)
  }
  for (const command of [
    'dsh plugin --profile web add github:Sazmir/dsh-llm-arena#v0.1.1',
    'dsh --profile web --dump-config',
    'npm run verify',
    'npm run test:live',
    'dsh plugin --profile web remove dsh-llm-arena',
  ]) {
    assert.ok(english.includes(command), `English README misses ${command}`)
    assert.ok(russian.includes(command), `Russian README misses ${command}`)
  }
  assert.equal((english.match(/^## /gm) ?? []).length, (russian.match(/^## /gm) ?? []).length)
  assert.equal((english.match(/^### /gm) ?? []).length, (russian.match(/^### /gm) ?? []).length)
})

test('tracked source tree contains no obvious credentials or machine-local paths', async () => {
  const patterns = [
    /sk-[A-Za-z0-9_-]{12,}/,
    /gh[opusr]_[A-Za-z0-9]{12,}/,
    /Authorization:\s*Bearer\s+[A-Za-z0-9._-]{8,}/i,
    /C:\\Users\\[^\\\s]+/i,
    /G:\\DHWork/i,
    /Cloudflare\s+Ray\s+ID/i,
  ]
  for (const file of await filesBelow(root)) {
    if (path.basename(file) === 'package-lock.json') continue
    const text = await readFile(file, 'utf8').catch(() => undefined)
    if (text === undefined) continue
    for (const pattern of patterns) {
      assert.equal(pattern.test(text), false, `${path.relative(root, file)} matched ${pattern}`)
    }
  }
})
