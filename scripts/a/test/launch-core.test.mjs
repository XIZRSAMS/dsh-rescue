import { test } from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { REPO_ROOT, RUNTIME_DIR } from '../../_shared.mjs'
import { buildLauncherArgs, kernelCandidates, locateKernel } from '../lib/launch-core.mjs'

const layers = (ui = 'minimal') => ({
  profile: { name: 'rescue', ui },
  server: { host: '127.0.0.1', port: 3080 },
})

test('buildLauncherArgs forwards only the kernel flags', () => {
  const args = buildLauncherArgs({ layers: layers('minimal') })
  assert.deepEqual(args, ['--profile', 'rescue', '--host', '127.0.0.1', '--port', '3080', '--no-open'])
  for (const rescueOnly of ['--ui', '--open', '--home', '--kernel']) {
    assert.ok(!args.includes(rescueOnly), rescueOnly + ' must not reach the kernel')
  }
  assert.ok(args.includes('--no-open'), 'the rescue launcher must not open a browser')
})

test('openBrowser=true suppresses --no-open', () => {
  const withOpen = layers('minimal')
  withOpen.server.openBrowser = true
  assert.ok(!buildLauncherArgs({ layers: withOpen }).includes('--no-open'))
})

test('ui=full adds --patch only when an overlay exists', () => {
  const overlay = join(RUNTIME_DIR, 'full.patch.yml')
  const withOverlay = buildLauncherArgs({ layers: layers('full'), overlay })
  assert.deepEqual(withOverlay.slice(0, 4), ['--profile', 'rescue', '--patch', overlay])

  const withoutOverlay = buildLauncherArgs({ layers: layers('full'), overlay: undefined })
  assert.ok(!withoutOverlay.includes('--patch'))

  const minimal = buildLauncherArgs({ layers: layers('minimal'), overlay })
  assert.ok(!minimal.includes('--patch'))
})

test('passthrough args after -- reach the app unchanged', () => {
  const args = buildLauncherArgs({ layers: layers('minimal'), passthrough: ['--resume', 'abc'] })
  assert.deepEqual(args.slice(-2), ['--resume', 'abc'])
})

test('kernel candidates match the fallback launcher order', () => {
  const fallback = readFileSync(join(REPO_ROOT, 'scripts', 'fallback-launch.mjs'), 'utf8')
  assert.ok(fallback.includes("'node_modules', '@deepseek-ai', 'dsh', 'lib', 'bin.js'"))
  assert.ok(fallback.includes("'dsh', 'lib', 'bin.js'"))

  const candidates = kernelCandidates(RUNTIME_DIR, {})
  assert.equal(candidates.length, 2)
  assert.ok(candidates[0].endsWith(join('node_modules', '@deepseek-ai', 'dsh', 'lib', 'bin.js')))
  assert.ok(candidates[1].endsWith(join('dsh', 'lib', 'bin.js')))

  const explicit = kernelCandidates(RUNTIME_DIR, { DSH_RESCUE_KERNEL_BIN: 'X:/bin.js' })
  assert.equal(explicit.length, 3)
  assert.equal(explicit[0], 'X:/bin.js')
})

test('DSH_RESCUE_KERNEL_BIN wins over the runtime layouts', () => {
  const runtime = RUNTIME_DIR
  const candidates = kernelCandidates(runtime, {})
  const npmCandidate = candidates[0]
  const legacyCandidate = candidates[1]
  const explicit = 'X:/explicit/dsh/lib/bin.js'

  assert.equal(locateKernel({ runtimeDir: runtime, env: { DSH_RESCUE_KERNEL_BIN: explicit }, exists: (p) => p === explicit }), explicit)
  assert.equal(locateKernel({ runtimeDir: runtime, env: {}, exists: (p) => p === npmCandidate }), npmCandidate)
  assert.equal(locateKernel({ runtimeDir: runtime, env: {}, exists: (p) => p === legacyCandidate }), legacyCandidate)
  assert.equal(locateKernel({ runtimeDir: runtime, env: {}, exists: () => false }), undefined)

  const both = (p) => p === explicit || p === npmCandidate
  assert.equal(locateKernel({ runtimeDir: runtime, env: { DSH_RESCUE_KERNEL_BIN: explicit }, exists: both }), explicit)
})

test('--help prints usage without requiring a kernel', () => {
  const result = spawnSync(process.execPath, [join(REPO_ROOT, 'src', 'launch.mjs'), '--help'], {
    encoding: 'utf8',
    cwd: REPO_ROOT,
    timeout: 30000,
  })
  assert.equal(result.status, 0, result.stderr)
  for (const token of ['--profile', '--patch', '--host', '--port']) {
    assert.ok(result.stdout.includes(token), 'help must mention ' + token)
  }
})
