#!/usr/bin/env node
/**
 * dsh-rescue · launcher entry
 *
 * `start.cmd` / `start.sh` forward everything here. This module owns the argv
 * contract so the .cmd stays a two-line shim:
 *
 *   --ui minimal|full     UI preset (sets DSH_RESCUE_UI and adds the overlay)
 *   --host <host>         web bind host (default 127.0.0.1)
 *   --port <port>         web port (default 3080)
 *   --profile <name>      profile under $DSH_HOME/profiles (default rescue)
 *   --open                open the browser (default: no)
 *   -- <args...>          passed through to the booted app
 *
 * When the A-side launcher (`src/launch.mjs`) exists it takes over; otherwise
 * the bundled fallback launches the kernel directly.
 */

import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { join } from 'node:path'

import { DEFAULT_PROFILE, REPO_ROOT, RUNTIME_DIR, parseArgs, readJson } from './_shared.mjs'

const argv = process.argv.slice(2)
const args = parseArgs(argv)

const versionInfo = readJson(join(REPO_ROOT, 'dsh-version.json'), {})
const profile = String(args.profile || process.env.DSH_RESCUE_PROFILE || DEFAULT_PROFILE)
const ui = String(args.ui || process.env.DSH_RESCUE_UI || 'minimal').toLowerCase()
const host = String(args.host || process.env.DSH_RESCUE_HOST || '127.0.0.1')
const port = String(args.port || process.env.DSH_RESCUE_PORT || '3080')
const openBrowser = args.open === true || args['no-open'] === false

const home = String(args.home || process.env.DSH_RESCUE_HOME || join(RUNTIME_DIR, 'home'))

const env = {
  ...process.env,
  DSH_HOME: home,
  DSH_RESCUE_PROFILE: profile,
  DSH_RESCUE_UI: ['minimal', 'full'].includes(ui) ? ui : 'minimal',
  DSH_RESCUE_VERSION: String(versionInfo.kernelVersion || ''),
  DSH_RESCUE_LOCAL: '1',
}

console.log(`[dsh-rescue] profile=${profile} ui=${env.DSH_RESCUE_UI} home=${home}`)
console.log(`[dsh-rescue] url: http://${host === '0.0.0.0' ? '127.0.0.1' : host}:${port}/`)

/** A-side launcher takes precedence when present. */
const aSide = join(REPO_ROOT, 'src', 'launch.mjs')
const target = existsSync(aSide) ? aSide : join(REPO_ROOT, 'scripts', 'fallback-launch.mjs')

// The launcher (A-side or fallback) reads the same rescue env and resolves the
// full overlay itself; pass the original argv through unchanged.
const child = spawn(process.execPath, [target, ...process.argv.slice(2)], {
  env,
  stdio: 'inherit',
  windowsHide: false,
})

child.on('exit', (code, signal) => {
  if (signal) {
    process.kill(process.pid, signal)
    return
  }
  process.exit(code === null ? 1 : code)
})

child.on('error', (error) => {
  console.error('[dsh-rescue] failed to start:', String((error && error.message) || error))
  process.exit(1)
})

// Forward the common console signals so `Ctrl+C` reaches the kernel.
for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => {
    try {
      child.kill(signal)
    } catch {
      /* already gone */
    }
  })
}
