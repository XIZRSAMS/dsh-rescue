#!/usr/bin/env node
/**
 * dsh-rescue · verify
 *
 *   node scripts/verify.mjs --compose   static assertions on the rendered profile
 *   node scripts/verify.mjs --privacy   repository privacy gate
 *   node scripts/verify.mjs --boot      start the web server and probe the route
 *   node scripts/verify.mjs --all       compose + privacy (add --boot yourself)
 *
 * Exit codes: 0 ok (or skipped), 1 failure.
 */

import { spawn } from 'node:child_process'
import { join } from 'node:path'

import { REPO_ROOT, RUNTIME_DIR, exists, parseArgs, readJson, readText, resolveLayers } from './_shared.mjs'
import { scanRepository } from './privacy-scan.mjs'

const args = parseArgs()
const versionInfo = readJson(join(REPO_ROOT, 'dsh-version.json'), {})
const fileConfig = readJson(join(REPO_ROOT, 'config.json'), null)
const layers = resolveLayers({ cli: args, file: fileConfig || {} })

const profileDir = join(layers.home, 'profiles', layers.profile.name)
const failures = []
const passes = []
const skips = []

const ok = (message) => passes.push(message)
const bad = (message) => failures.push(message)
const skip = (message) => skips.push(message)

/* ── compose ────────────────────────────────────────────────────────────── */

function checkCompose() {
  const manifestPath = join(profileDir, 'package.json')
  const patchPath = join(profileDir, 'cordis.patch.yml')

  if (!exists(manifestPath)) {
    bad(`missing ${manifestPath} — run: node scripts/setup.mjs`)
    return
  }
  if (!exists(patchPath)) {
    bad(`missing ${patchPath} — run: node scripts/setup.mjs`)
    return
  }

  const manifest = readJson(manifestPath, {})
  const bundles = manifest?.dsh?.profile?.bundles || []
  for (const required of ['@deepseek-ai/dsh-base', '@deepseek-ai/dsh-web-app', 'dsh-plugin-degraded']) {
    if (bundles.includes(required)) ok(`bundle listed: ${required}`)
    else bad(`bundle missing from dsh.profile.bundles: ${required}`)
  }

  const spec = manifest?.dependencies?.['dsh-plugin-degraded']
  if (typeof spec === 'string' && spec.startsWith('file:')) ok(`plugin dependency: ${spec}`)
  else bad(`dsh-plugin-degraded dependency must be a file: specifier, got ${JSON.stringify(spec)}`)

  const patch = readText(patchPath)
  if (/- id: rescue-degraded/u.test(patch)) ok('patch targets rescue-degraded')
  else bad('patch does not target rescue-degraded')

  if (/^\s*ui:\s*(minimal|full|auto)\s*$/mu.test(patch)) ok('patch states the ui preset')
  else bad('patch does not state the ui preset')

  const expected = layers.profile.ui === 'full' ? 'false' : 'true'
  const decoration = /- id: ui-sidebar-documentpreview\s*\n\s*disabled:\s*(true|false)/u.exec(patch)
  if (!decoration) bad('patch does not control ui-sidebar-documentpreview')
  else if (decoration[1] === expected) ok(`ui-sidebar-documentpreview disabled=${expected}`)
  else bad(`ui-sidebar-documentpreview disabled=${decoration[1]}, expected ${expected}`)

  const startCmd = join(REPO_ROOT, 'start.cmd')
  if (exists(startCmd)) ok('static start.cmd present')
  else bad('start.cmd is missing (the hand-written launcher must be committed)')

  const composed = join(RUNTIME_DIR, 'logs', 'composed.yml')
  if (exists(composed)) {
    const tree = readText(composed)
    if (/rescue-degraded/u.test(tree)) ok('dump-config contains the rescue row')
    else bad('dump-config does not contain rescue-degraded — the bundle may not be installed')
  } else {
    skip('no runtime/logs/composed.yml (run setup with a kernel to produce it)')
  }
}

/* ── privacy ────────────────────────────────────────────────────────────── */

function checkPrivacy() {
  const result = scanRepository()
  if (result.ok) {
    ok(`privacy: ${result.scanned} text files clean`)
    return
  }
  for (const violation of result.violations) {
    bad(`privacy: ${violation.path} → ${violation.rule} (${violation.note})`)
  }
}

/* ── boot ───────────────────────────────────────────────────────────────── */

async function waitForServer(url, timeoutMs) {
  const started = Date.now()
  let lastError = ''
  while (Date.now() - started < timeoutMs) {
    try {
      const response = await fetch(url, { headers: { accept: 'application/json' } })
      if (response.ok) return { ok: true, body: await response.json() }
      lastError = `HTTP ${response.status}`
    } catch (error) {
      lastError = String((error && error.message) || error)
    }
    await new Promise((resolve) => setTimeout(resolve, 1000))
  }
  return { ok: false, error: lastError }
}

async function checkBoot() {
  const kernel = join(RUNTIME_DIR, 'node_modules', '@deepseek-ai', 'dsh', 'lib', 'bin.js')
  if (!exists(kernel) && !process.env.DSH_RESCUE_KERNEL_BIN) {
    if (args['require-boot'] === true) bad('boot: kernel missing and --require-boot was passed')
    else skip('boot: kernel not installed (run setup with --kernel npm|vendor)')
    return
  }

  const port = String(args.port || layers.server.port || '3080')
  const host = '127.0.0.1'
  // The loopback-only route: `/api/...` sits behind the browser trust fence and
  // returns 401 without a session cookie, which a bare fetch never has.
  const url = `http://${host}:${port}/dsh-rescue/capabilities.json`

  const child = spawn(
    process.execPath,
    [join(REPO_ROOT, 'scripts', 'entry.mjs'), '--port', port, '--host', host, '--ui', layers.profile.ui],
    { env: { ...process.env, DSH_RESCUE_PROFILE: layers.profile.name }, stdio: ['ignore', 'pipe', 'pipe'] },
  )

  let output = ''
  child.stdout?.on('data', (chunk) => {
    output += String(chunk)
  })
  child.stderr?.on('data', (chunk) => {
    output += String(chunk)
  })

  const timeoutMs = Number(args.timeout || 180) * 1000
  const result = await waitForServer(url, timeoutMs)

  try {
    if (process.platform === 'win32') {
      spawn('taskkill', ['/pid', String(child.pid), '/t', '/f'], { stdio: 'ignore' })
    } else {
      child.kill('SIGTERM')
    }
  } catch {
    /* ignore */
  }

  if (!result.ok) {
    bad(`boot: ${url} never became ready (${result.error})`)
    const tail = output.trim().split(/\r?\n/u).slice(-12).join('\n')
    if (tail) console.error(tail)
    return
  }

  const body = result.body || {}
  if (body.policy && typeof body.policy.uiPreset === 'string') ok(`boot: route responded (uiPreset=${body.policy.uiPreset})`)
  else bad('boot: route responded without a policy block')

  if (body.capabilities && body.capabilities.shell && typeof body.capabilities.shell.mode === 'string') {
    ok(`boot: shell mode = ${body.capabilities.shell.mode}`)
  } else {
    bad('boot: capabilities.shell.mode missing')
  }

  if (Array.isArray(body.policy?.disabledTools)) ok(`boot: disabledTools = ${body.policy.disabledTools.length}`)
  else bad('boot: policy.disabledTools is not an array')
}

/* ── run ────────────────────────────────────────────────────────────────── */

const all = args.all === true
const runCompose = all || args.compose === true
const runPrivacy = all || args.privacy === true
const runBoot = args.boot === true

if (!runCompose && !runPrivacy && !runBoot) {
  console.log('usage: node scripts/verify.mjs --compose | --privacy | --boot | --all')
  process.exit(0)
}

if (runCompose) checkCompose()
if (runPrivacy) checkPrivacy()
if (runBoot) await checkBoot()

console.log(`dsh-rescue verify · kernel ${versionInfo.kernelVersion || '?'} · profile ${layerOrDash()}`)
for (const message of passes) console.log(`  ok   ${message}`)
for (const message of skips) console.log(`  skip ${message}`)
for (const message of failures) console.log(`  FAIL ${message}`)

function layerOrDash() {
  try {
    return layers.profile.name
  } catch {
    return '-'
  }
}

if (failures.length > 0) {
  console.error(`\n${failures.length} check(s) failed`)
  process.exit(1)
}
console.log('\nall checks passed')
