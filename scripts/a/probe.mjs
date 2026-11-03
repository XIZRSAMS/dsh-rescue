#!/usr/bin/env node
/**
 * P1 · probe this machine and write runtime/logs/probe.json.
 *
 * The capability detection itself is NOT reimplemented: this imports the same
 * scripts/_probe.mjs adapter the plugin, doctor and setup use, then adds the
 * three facts the task contract requires on top (portFree, diskFreeMB,
 * kernelSource).
 */

import { join } from 'node:path'

import { REPO_ROOT, RUNTIME_DIR, exists, parseArgs, readJson, resolveLayers, table } from '../_shared.mjs'
import { probeThisMachine } from '../_probe.mjs'
import { diskFreeMB, isPortFree, nowIso, writeLogJson } from './lib/util.mjs'
import { validateProbeRecord } from './lib/judge.mjs'

const args = parseArgs()

if (args.help === true) {
  console.log('usage: node scripts/a/probe.mjs [--home <dir>] [--port <port>] [--kernel npm|vendor|existing] [--json]')
  process.exit(0)
}

const versionInfo = readJson(join(REPO_ROOT, 'dsh-version.json'), {})
const fileConfig = readJson(join(REPO_ROOT, 'config.json'), null) || {}
const layers = resolveLayers({ cli: args, file: fileConfig, env: process.env })
const home = layers.home
const port = Number(args.port || layers.server.port || 3080)

/** npm / vendor / existing: what the caller says, else what is on disk. */
function detectKernelSource() {
  const explicit = String(args.kernel || process.env.DSH_RESCUE_KERNEL || '').toLowerCase()
  if (explicit === 'npm' || explicit === 'vendor' || explicit === 'existing') return explicit
  if (process.env.DSH_RESCUE_KERNEL_BIN && exists(process.env.DSH_RESCUE_KERNEL_BIN)) return 'existing'
  if (exists(join(RUNTIME_DIR, 'node_modules', '@deepseek-ai', 'dsh', 'lib', 'bin.js'))) return 'npm'
  const vendorDir = String(args['vendor-dir'] || process.env.DSH_RESCUE_VENDOR_DIR || '')
  if (vendorDir && exists(vendorDir)) return 'vendor'
  return 'none'
}

/* The probe reads DSH_HOME from the environment; point it at the rescue home
 * for the duration of this call so dshHomeWritable describes the right dir. */
const previousHome = process.env.DSH_HOME
process.env.DSH_HOME = home

let capabilities
try {
  capabilities = probeThisMachine({ dshRoot: join(RUNTIME_DIR, 'node_modules') })
} finally {
  if (previousHome === undefined) delete process.env.DSH_HOME
  else process.env.DSH_HOME = previousHome
}

const record = {
  ...capabilities,
  port,
  portFree: await isPortFree(port),
  diskFreeMB: diskFreeMB(RUNTIME_DIR),
  kernelSource: detectKernelSource(),
  generatedAt: nowIso(),
}

const check = validateProbeRecord(record)
const out = writeLogJson('probe.json', record)

if (args.json === true) {
  console.log(JSON.stringify({ ok: check.ok, missing: check.missing, out, record }, null, 2))
} else {
  console.log(
    table([
      ['out', out],
      ['kernel', String(versionInfo.kernelPackage || '@deepseek-ai/dsh') + '@' + String(versionInfo.kernelVersion || '?')],
      ['kernelSource', record.kernelSource],
      ['shell', record.shell.mode + (record.shell.executable ? ' · ' + record.shell.name : '')],
      ['terminal', (record.terminal.available === null ? 'unknown' : String(record.terminal.available)) + ' · backends=' + record.terminal.backends.length],
      ['ui', 'gpu=' + String(record.ui.gpu) + ' decorationAllowed=' + String(record.ui.decorationAllowed)],
      ['image', 'preview=' + String(record.image.preview)],
      ['env', 'PE=' + String(record.env.isPE) + ' homeWritable=' + String(record.env.dshHomeWritable)],
      ['port', String(record.port) + ' free=' + String(record.portFree)],
      ['diskFreeMB', String(record.diskFreeMB)],
    ]),
  )
}

if (!check.ok) {
  console.error('[dsh-rescue] probe record is missing: ' + check.missing.join(', '))
  process.exit(1)
}
