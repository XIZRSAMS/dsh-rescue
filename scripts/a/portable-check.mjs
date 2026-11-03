#!/usr/bin/env node
/**
 * Portability check: boot through the repository-root start.cmd with a PATH that
 * has no Node on it. This is the only acceptance case that proves the runtime is
 * self-contained rather than borrowing the developer's Node.
 */

import { join } from 'node:path'

import { REPO_ROOT, RUNTIME_DIR, exists, parseArgs, readJson } from '../_shared.mjs'
import { freePort, nowIso, runCapture, writeLogJson } from './lib/util.mjs'
import { runBoot } from './boot.mjs'

const args = parseArgs()
if (args.help === true) {
  console.log('usage: node scripts/a/portable-check.mjs [--timeout <seconds>] [--json]')
  process.exit(0)
}

const systemRoot = process.env.SystemRoot || 'C:\\Windows'
const restrictedPath = [systemRoot, join(systemRoot, 'System32'), join(systemRoot, 'System32', 'Wbem')].join(';')

const where = await runCapture(join(systemRoot, 'System32', 'where.exe'), ['node'], {
  env: { ...process.env, PATH: restrictedPath },
  timeoutMs: 20000,
})
const pathHasNode = where.code === 0

const port = await freePort()
const startCmd = join(REPO_ROOT, 'start.cmd')
const nodeExe = join(RUNTIME_DIR, 'node', 'node.exe')

const result = await runBoot({
  label: 'portable',
  home: join(RUNTIME_DIR, 'home'),
  port,
  timeoutMs: Number(args.timeout || 15) * 1000,
  env: { PATH: restrictedPath },
  command: join(systemRoot, 'System32', 'cmd.exe'),
  /* cmd.exe needs the whole command as one verbatim string; otherwise Node
   * escapes the quotes around a path that may contain spaces. */
  windowsVerbatimArguments: true,
  args: ['/d', '/s', '/c', '"' + startCmd + '" --port ' + String(port) + ' --host 127.0.0.1 --ui minimal'],
})

const record = {
  at: nowIso(),
  ok: result.ok && !pathHasNode,
  readyMs: result.readyMs,
  pathHasNode,
  nodePath: nodeExe,
  nodePresent: exists(nodeExe),
  startCmd,
  status: result.status,
  exitCode: result.exitCode,
  kind: result.kind,
  whereNode: String(where.stdout || '').trim().slice(0, 300),
  logs: result.logs,
  stderrTail: result.stderrTail,
}

const out = writeLogJson('portable.json', record)
if (args.json === true) console.log(JSON.stringify(record, null, 2))
else {
  console.log('[dsh-rescue] portable.json → ' + out)
  console.log(
    [
      'ok            ' + String(record.ok),
      'readyMs       ' + (record.readyMs === null ? '-' : String(record.readyMs)),
      'pathHasNode   ' + String(record.pathHasNode) + (record.whereNode ? ' (' + record.whereNode.split(/\r?\n/u)[0] + ')' : ''),
      'nodePresent   ' + String(record.nodePresent),
      'status        ' + String(record.status),
    ].join('\n'),
  )
  if (!record.ok && record.stderrTail) console.error('[dsh-rescue] web.err (tail 20):\n' + record.stderrTail)
}

if (!record.ok) process.exit(1)
