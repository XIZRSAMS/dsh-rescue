#!/usr/bin/env node
/**
 * A-side runner: P1 probe → P2 provision → P3 launcher check → P4 boot →
 * P5 matrix → portability, then runtime/logs/summary.{json,md}.
 */

import { spawn } from 'node:child_process'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

import { REPO_ROOT, RUNTIME_DIR, exists, parseArgs, readJson, table, writeText } from '../_shared.mjs'
import { LOG_DIR, nowIso, writeLogJson } from './lib/util.mjs'

const HERE = dirname(fileURLToPath(import.meta.url))
const args = parseArgs()

if (args.help === true) {
  console.log(
    [
      'usage: node scripts/a/run.mjs [--all] [--only p1,p2,p4,p5,portable] [--skip-provision]',
      '  runs the A-side programs in order and writes runtime/logs/summary.{json,md}',
    ].join('\n'),
  )
  process.exit(0)
}

const only = String(args.only || '')
  .split(',')
  .map((item) => item.trim())
  .filter(Boolean)
const wants = (id) => only.length === 0 || only.includes(id)

function runScript(name, extra = []) {
  return new Promise((resolvePromise) => {
    const child = spawn(process.execPath, [join(HERE, name), ...extra], {
      cwd: REPO_ROOT,
      stdio: 'inherit',
      windowsHide: false,
    })
    child.on('exit', (code) => resolvePromise(code === null ? 1 : code))
    child.on('error', () => resolvePromise(1))
  })
}

const runStartedAt = nowIso()
const results = {}

if (wants('p1')) {
  results.p1 = await runScript('probe.mjs')
  if (results.p1 !== 0) {
    console.error('[dsh-rescue] P1 failed; stopping (probe record is the prerequisite for every later step)')
    process.exit(1)
  }
}

if (wants('p2') && args['skip-provision'] !== true) {
  results.p2 = await runScript('provision.mjs')
  if (results.p2 !== 0) {
    console.error('[dsh-rescue] P2 failed; stopping (the portable runtime is required)')
    process.exit(1)
  }
}

/* P3 · launcher contract: kernel present + --help works. */
if (wants('p3') || wants('p1')) {
  const kernel = join(RUNTIME_DIR, 'node_modules', '@deepseek-ai', 'dsh', 'lib', 'bin.js')
  const help = await new Promise((resolvePromise) => {
    const child = spawn(process.execPath, [join(REPO_ROOT, 'src', 'launch.mjs'), '--help'], {
      cwd: REPO_ROOT,
      stdio: 'ignore',
      windowsHide: false,
    })
    child.on('exit', (code) => resolvePromise(code === null ? 1 : code))
    child.on('error', () => resolvePromise(1))
  })
  results.p3 = exists(kernel) && help === 0 ? 0 : 1
  console.log('[dsh-rescue] P3 launcher: kernel=' + String(exists(kernel)) + ' helpExit=' + String(help))
  if (results.p3 !== 0) {
    console.error('[dsh-rescue] P3 failed (missing kernel or broken --help)')
    process.exit(1)
  }
}

if (wants('p4')) results.p4 = await runScript('boot.mjs')
if (wants('p5')) results.p5 = await runScript('matrix.mjs')
if (wants('portable')) results.portable = await runScript('portable-check.mjs')

/* ── summary ─────────────────────────────────────────────────────────────── */

const probe = readJson(join(LOG_DIR, 'probe.json'), null)
const manifest = readJson(join(LOG_DIR, 'manifest.json'), null)
const boot = readJson(join(LOG_DIR, 'boot.json'), null)
const matrix = readJson(join(LOG_DIR, 'matrix.json'), null)
const portable = readJson(join(LOG_DIR, 'portable.json'), null)

const partial = only.length > 0
const isFresh = (record) => Boolean(record && typeof record.at === 'string' && record.at >= runStartedAt)
const allStepsOk = Object.values(results).every((code) => code === 0)
const matrixFresh = Array.isArray(matrix) && matrix.length > 0 && matrix.every((item) => isFresh(item))
const matrixOk = Array.isArray(matrix) ? matrix.every((item) => item.ok) : false
const summary = {
  at: nowIso(),
  runStartedAt,
  partial,
  ok: partial
    ? allStepsOk
    : allStepsOk && isFresh(boot) && boot?.ok === true && matrixFresh && matrixOk && isFresh(portable) && portable?.ok === true,
  steps: results,
  kernel: manifest?.kernel || null,
  node: manifest?.node || null,
  probe: probe
    ? {
        kernelSource: probe.kernelSource,
        shell: probe.shell?.mode,
        terminal: probe.terminal?.available,
        portFree: probe.portFree,
        diskFreeMB: probe.diskFreeMB,
      }
    : null,
  boot: boot
    ? { fresh: isFresh(boot), ok: boot.ok, kind: boot.kind, readyMs: boot.readyMs, status: boot.status, capsSummary: boot.capsSummary, port: boot.port }
    : null,
  matrix: Array.isArray(matrix)
    ? matrix.map((item) => ({ fresh: isFresh(item), case: item.case, ok: item.ok, kind: item.kind, readyMs: item.readyMs, shellMode: item.shellMode }))
    : null,
  portable: portable ? { fresh: isFresh(portable), ok: portable.ok, readyMs: portable.readyMs, pathHasNode: portable.pathHasNode } : null,
  warnings: manifest?.warnings || [],
}

const summaryJson = writeLogJson('summary.json', summary)
const md = [
  '# dsh-rescue · A 版验收总结',
  '',
  '- 生成时间: ' + summary.at,
  '- 运行范围: ' + (summary.partial ? '部分（--only）' : '全部（P1–P5 + 便携）'),
  '- 结论: ' + (summary.ok ? 'PASS' : 'FAIL'),
  '- kernel: ' + (summary.kernel ? summary.kernel.version + ' (' + summary.kernel.source + ') sha256=' + String(summary.kernel.sha256).slice(0, 12) : '-'),
  '- node: ' + (summary.node ? summary.node.version + ' sha256=' + String(summary.node.sha256).slice(0, 12) : '-'),
  '- 冷启动 readyMs: ' + (boot && boot.readyMs !== null && boot.readyMs !== undefined ? String(boot.readyMs) : '-'),
  '- 便携启动 readyMs: ' + (portable && portable.readyMs !== null && portable.readyMs !== undefined ? String(portable.readyMs) : '-'),
  '',
  '## 矩阵',
  '',
  ...(Array.isArray(matrix) ? matrix.map((item) => '- ' + item.case + ': ' + (item.ok ? 'ok' : 'FAIL') + ' · kind=' + item.kind + ' · shell=' + (item.shellMode || '-')) : ['- 未运行']),
  '',
  '## 警告',
  '',
  ...(summary.warnings.length > 0 ? summary.warnings.map((warning) => '- ' + warning) : ['- 无']),
  '',
].join('\n')

writeText(join(LOG_DIR, 'summary.md'), md)

console.log('')
console.log(table(Object.entries(results).map(([key, code]) => [key, code === 0 ? 'ok' : 'FAIL ' + String(code)])))
console.log('[dsh-rescue] summary → ' + summaryJson)
console.log('[dsh-rescue] ' + (summary.ok ? 'PASS' : 'FAIL'))

if (!summary.ok) process.exit(1)
