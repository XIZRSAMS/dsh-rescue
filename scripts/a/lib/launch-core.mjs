/**
 * Pure helpers for the A-side launcher (src/launch.mjs).
 *
 * Kept out of src/ so the launcher contract is unit-testable without spawning a
 * kernel, and so scripts/a can reuse the exact same kernel resolution order.
 */

import { existsSync } from 'node:fs'
import { join } from 'node:path'

/** Kernel entry relative to <repo>/runtime (preferred layout). */
export const RUNTIME_KERNEL_PATH = join('node_modules', '@deepseek-ai', 'dsh', 'lib', 'bin.js')

/** Legacy layout kept by the B-side fallback launcher. */
export const LEGACY_KERNEL_PATH = join('dsh', 'lib', 'bin.js')

/**
 * Flags owned by the rescue launcher itself; they must never reach the kernel.
 * The kernel's web app understands --host, --port and --trusted-host only.
 */
export const RESCUE_ONLY_FLAGS = Object.freeze([
  '--ui',
  '--open',
  '--home',
  '--kernel',
  '--vendor-dir',
  '--existing',
  '--force',
  '--shell',
  '--terminal',
  '--image',
  '--ui-mode',
  '--no-install',
  '--dry-run',
  '--json',
  '--help',
])

/**
 * Kernel candidates in the same order as scripts/fallback-launch.mjs.
 *
 * @param {string} runtimeDir
 * @param {Record<string, string | undefined>} [env]
 * @returns {string[]}
 */
export function kernelCandidates(runtimeDir, env = {}) {
  return [
    env.DSH_RESCUE_KERNEL_BIN,
    join(runtimeDir, RUNTIME_KERNEL_PATH),
    join(runtimeDir, LEGACY_KERNEL_PATH),
  ].filter((candidate) => typeof candidate === 'string' && candidate.length > 0)
}

/**
 * @param {{ runtimeDir: string, env?: Record<string, string | undefined>, exists?: (path: string) => boolean }} options
 * @returns {string | undefined}
 */
export function locateKernel(options) {
  const exists = options.exists || existsSync
  for (const candidate of kernelCandidates(options.runtimeDir, options.env || {})) {
    if (exists(candidate)) return candidate
  }
  return undefined
}

/**
 * Build the argv the kernel receives.
 *
 * @param {{ layers?: any, overlay?: string | null, passthrough?: string[] }} [options]
 * @returns {string[]}
 */
export function buildLauncherArgs(options = {}) {
  const layers = options.layers || {}
  const profile = String((layers.profile && layers.profile.name) || 'rescue')
  const ui = String((layers.profile && layers.profile.ui) || 'minimal').toLowerCase()
  const host = String((layers.server && layers.server.host) || '127.0.0.1')
  const port = String((layers.server && layers.server.port) || '3080')

  const openBrowser = Boolean(layers.server && layers.server.openBrowser)

  const args = ['--profile', profile]
  if (ui === 'full' && typeof options.overlay === 'string' && options.overlay.length > 0) {
    args.push('--patch', options.overlay)
  }
  args.push('--host', host, '--port', port)
  /* 0.2.0-rc.2 opens the default browser by default; a rescue launcher must not
   * do that. --no-open is a kernel flag (not a rescue flag), so it is forwarded. */
  if (!openBrowser) args.push('--no-open')

  for (const item of options.passthrough || []) {
    if (typeof item === 'string' && item.length > 0) args.push(item)
  }
  return args
}

export function usageText() {
  return [
    'dsh-rescue launcher (A-side)',
    '',
    'usage: node src/launch.mjs [--profile <name>] [--ui minimal|full] [--host <host>] [--port <port>] [-- <app args...>]',
    '',
    'layers: CLI > environment (DSH_RESCUE_*) > config.json > built-in defaults',
    'kernel: DSH_RESCUE_KERNEL_BIN > runtime/node_modules/@deepseek-ai/dsh/lib/bin.js > runtime/dsh/lib/bin.js',
    'ui=full adds --patch runtime/full.patch.yml when that overlay exists.',
    '',
    'The launcher forwards only --profile / --patch / --host / --port to the kernel;',
    'rescue-only flags (--ui, --open, --home, --kernel, ...) are consumed here.',
  ].join('\n')
}
