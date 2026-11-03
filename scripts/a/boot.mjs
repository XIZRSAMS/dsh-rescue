#!/usr/bin/env node
/**
 * P4 · cold-start self check.
 *
 * Starts the rescue entry with the portable node, polls the loopback-only
 * capabilities route (never /api/*, which is behind the browser trust fence),
 * records readyMs and kills the whole process tree.
 */

import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { REPO_ROOT, RUNTIME_DIR, ensureDir, exists, parseArgs, readJson, resolveLayers, table } from '../_shared.mjs'
import { LOG_DIR, freePort, killTree, nowIso, spawnService, tailLines, waitForHttp, writeLogJson } from './lib/util.mjs'
import { classifyRun, summarizeCapabilities } from './lib/judge.mjs'

/**
 * @param {object} [options]
 * @returns {Promise<object>} the boot.json record
 */
export async function runBoot(options = {}) {
  const home = String(options.home || join(RUNTIME_DIR, 'home'))
  const profile = String(options.profile || process.env.DSH_RESCUE_PROFILE || 'rescue')
  const ui = String(options.ui || process.env.DSH_RESCUE_UI || 'minimal').toLowerCase()
  const timeoutMs = Number(options.timeoutMs || 15000)
  const label = String(options.label || 'boot')
  const extraEnv = options.env && typeof options.env === 'object' ? options.env : {}
  const port = Number(options.port || 0) || (await freePort())

  const runtimeNode = join(RUNTIME_DIR, 'node', 'node.exe')
  const nodeExe = String(options.nodeExe || (exists(runtimeNode) ? runtimeNode : process.execPath))
  const entry = join(REPO_ROOT, 'scripts', 'entry.mjs')

  const command = String(options.command || nodeExe)
  const args = Array.isArray(options.args)
    ? options.args.map(String)
    : [entry, '--home', home, '--port', String(port), '--host', '127.0.0.1', '--ui', ui]

  const outPath = join(LOG_DIR, label === 'boot' ? 'web.out' : label + '.web.out')
  const errPath = join(LOG_DIR, label === 'boot' ? 'web.err' : label + '.web.err')

  /* Keep temporary spill files inside the portable tree: the host TEMP may be
   * missing (WinPE) or unwritable, and a rescue run must not depend on it. */
  const tempDir = join(RUNTIME_DIR, 'tmp')
  ensureDir(tempDir)

  const env = {
    ...process.env,
    DSH_HOME: home,
    DSH_RESCUE_HOME: home,
    DSH_RESCUE_PROFILE: profile,
    DSH_RESCUE_UI: ui,
    TEMP: tempDir,
    TMP: tempDir,
    ...extraEnv,
  }

  const service = spawnService(command, args, {
    env,
    outPath,
    errPath,
    cwd: REPO_ROOT,
    windowsVerbatimArguments: options.windowsVerbatimArguments === true,
  })
  let exited = null
  const donePromise = service.done.then((result) => {
    exited = result
    return result
  })

  const url = 'http://127.0.0.1:' + String(port) + '/dsh-rescue/capabilities.json'
  const response = await waitForHttp(url, {
    timeoutMs,
    shouldStop: () => exited !== null,
    stopReason: 'child exited before the route answered',
  })

  const readyMs = response.ok ? response.elapsedMs : null
  const capsSummary = response.ok ? summarizeCapabilities(response.body) : null

  if (response.ok || exited === null) {
    await killTree(service.child.pid)
  }

  const finished = await Promise.race([
    donePromise,
    new Promise((resolvePromise) => setTimeout(() => resolvePromise(null), 5000)),
  ])
  if (!response.ok && finished === null && service.child.pid) {
    await killTree(service.child.pid)
    await Promise.race([donePromise, new Promise((resolvePromise) => setTimeout(() => resolvePromise(null), 3000))])
  }

  const tail = service.tail()
  const exitCode = exited && typeof exited.code === 'number' ? exited.code : null
  const spawnError = exited && exited.error ? String(exited.error) : ''
  const combinedTail = [spawnError, tail.err, tail.out].filter(Boolean).join('\n')
  const stillAlive = exited === null
  const kind = classifyRun({
    responded: response.ok,
    exitCode,
    timedOut: stillAlive && response.ok !== true,
    tail: combinedTail,
  })

  return {
    at: nowIso(),
    label,
    port,
    readyMs,
    status: response.ok ? response.status : 0,
    capsSummary,
    exitCode,
    ok: response.ok,
    kind,
    error: response.ok ? '' : spawnError || response.error || 'no response',
    attempts: response.attempts,
    node: nodeExe,
    home,
    ui,
    logs: { out: outPath, err: errPath },
    stderrTail: tailLines(tail.err, 20),
  }
}

function printRecord(result) {
  console.log(
    table([
      ['status', String(result.status)],
      ['readyMs', result.readyMs === null ? '-' : String(result.readyMs)],
      ['kind', result.kind],
      ['port', String(result.port)],
      ['shell', result.capsSummary ? result.capsSummary.shellMode : '-'],
      ['uiPreset', result.capsSummary ? result.capsSummary.uiPreset : '-'],
      ['disabledTools', result.capsSummary ? String(result.capsSummary.disabledTools) : '-'],
      ['node', result.node],
    ]),
  )
  if (!result.ok && result.stderrTail) {
    console.error('[dsh-rescue] web.err (tail 20):\n' + result.stderrTail)
  }
}

const isMain = process.argv[1] ? resolve(process.argv[1]) === fileURLToPath(import.meta.url) : false

if (isMain) {
  const args = parseArgs()
  if (args.help === true) {
    console.log('usage: node scripts/a/boot.mjs [--home <dir>] [--port <port>] [--ui minimal|full] [--timeout <seconds>] [--label <name>] [--json]')
    process.exit(0)
  }

  const fileConfig = readJson(join(REPO_ROOT, 'config.json'), null) || {}
  const layers = resolveLayers({ cli: args, file: fileConfig, env: process.env })
  const result = await runBoot({
    home: layers.home,
    profile: layers.profile.name,
    ui: layers.profile.ui === 'auto' ? 'minimal' : layers.profile.ui,
    port: Number(args.port || 0),
    timeoutMs: Number(args.timeout || 15) * 1000,
    label: String(args.label || 'boot'),
  })

  const out = writeLogJson('boot.json', result)
  if (args.json === true) console.log(JSON.stringify(result, null, 2))
  else {
    console.log('[dsh-rescue] boot.json → ' + out)
    printRecord(result)
  }
  if (!result.ok) process.exit(1)
}
