/**
 * Host-side probe adapter for the scripts.
 *
 * Uses the SAME pure functions as the plugin (`lib/probe.js` / `lib/policy.js`),
 * so `doctor`, `setup` and `/rescue` can never disagree about a machine.
 */

import { accessSync, constants as fsConstants, lstatSync, mkdirSync, unlinkSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

import { probeCapabilities } from '../packages/dsh-plugin-degraded/lib/probe.js'
import { decide } from '../packages/dsh-plugin-degraded/lib/policy.js'
import { renderJson, renderReport } from '../packages/dsh-plugin-degraded/lib/report.js'
import { exists, readText, REPO_ROOT, RUNTIME_DIR } from './_shared.mjs'

function fileExists(path) {
  try {
    const stat = lstatSync(path)
    return stat.isFile() || stat.isSymbolicLink()
  } catch {
    return false
  }
}

function dirExists(path) {
  try {
    return lstatSync(path).isDirectory()
  } catch {
    return false
  }
}

function canWrite(dir) {
  if (!dir) return false
  try {
    mkdirSync(dir, { recursive: true })
  } catch {
    return false
  }
  const marker = join(dir, '.dsh-rescue-write-probe')
  try {
    accessSync(dir, fsConstants.W_OK)
    writeFileSync(marker, 'ok', { encoding: 'utf8' })
    unlinkSync(marker)
    return true
  } catch {
    try {
      unlinkSync(marker)
    } catch {
      /* ignore */
    }
    return false
  }
}

/**
 * Best-effort PTY backend discovery for CLI-only runs.
 *
 * At runtime the plugin reads `ctx.terminals.listBackends()`; offline we only
 * know whether node-pty was installed next to the kernel.
 */
function detectPtyBackends(roots = []) {
  for (const root of roots) {
    if (!root) continue
    for (const candidate of ['node-pty/package.json', '@homebridge/node-pty-prebuilt-multiarch/package.json']) {
      if (exists(join(root, 'node_modules', candidate))) return ['pty']
    }
  }
  return []
}

/**
 * Probe this machine.
 *
 * @param {{ dshRoot?: string, terminalBackends?: string[] }} [options]
 */
export function probeThisMachine(options = {}) {
  const dshRoot = options.dshRoot || process.env.DSH_RESCUE_DSH_ROOT || ''
  const backendRoots = [dshRoot, RUNTIME_DIR, join(REPO_ROOT, 'runtime')].filter(Boolean)

  return probeCapabilities({
    platform: process.platform,
    env: process.env,
    pathExists: fileExists,
    dirExists,
    canWrite,
    terminalBackends: () =>
      Array.isArray(options.terminalBackends) ? options.terminalBackends : detectPtyBackends(backendRoots),
  })
}

/**
 * Decide for this machine.
 *
 * @param {object} config normalized plugin config
 * @param {{ uiPreset?: string }} [overrides]
 * @param {object} [options] probe options
 */
export function decideThisMachine(config, overrides = {}, options = {}) {
  const capabilities = probeThisMachine(options)
  const policy = decide(capabilities, config, overrides)
  return { capabilities, policy }
}

/** Render the same report the plugin would render. */
export function reportThisMachine({ capabilities, policy }, meta = {}) {
  return renderReport({
    capabilities,
    policy,
    meta: {
      rescueVersion: meta.rescueVersion || process.env.DSH_RESCUE_VERSION || '0.1.0',
      profile: meta.profile || process.env.DSH_RESCUE_PROFILE || '',
      generatedAt: Date.now(),
    },
  })
}

export { renderJson, renderReport, readText }
