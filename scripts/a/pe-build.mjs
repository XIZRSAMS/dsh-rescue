#!/usr/bin/env node
/**
 * P6 · WinPE build pipeline (stage two, optional).
 *
 * The toolchain is detected before anything else: without the Windows ADK this
 * program records a skipped pe-build.json and exits 0, so the stage-one
 * acceptance never depends on an ISO being built.
 */

import { join } from 'node:path'

import { REPO_ROOT, RUNTIME_DIR, exists, parseArgs } from '../_shared.mjs'
import { nowIso, runCapture, writeLogJson } from './lib/util.mjs'

const args = parseArgs()
if (args.help === true) {
  console.log('usage: node scripts/a/pe-build.mjs [--adk <dir>] [--work <dir>] [--iso <path>] [--execute] [--json]')
  process.exit(0)
}

const programFiles = process.env.ProgramFiles || 'C:\\Program Files'
const programFilesX86 = process.env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)'
const adkRoots = [
  String(args.adk || ''),
  join(programFilesX86, 'Windows Kits', '10', 'Assessment and Deployment Kit'),
  join(programFiles, 'Windows Kits', '10', 'Assessment and Deployment Kit'),
].filter(Boolean)

const findFirst = (candidates) => candidates.find((candidate) => exists(candidate))
const copype = findFirst(adkRoots.map((root) => join(root, 'Windows Preinstallation Environment', 'amd64', 'copype.cmd')))
const oscdimg = findFirst(adkRoots.map((root) => join(root, 'Deployment Tools', 'amd64', 'Oscdimg', 'oscdimg.exe')))
const makeMedia = findFirst(adkRoots.map((root) => join(root, 'Windows Preinstallation Environment', 'MakeWinPEMedia.cmd')))
const workDir = String(args.work || join(RUNTIME_DIR, 'pe-build'))
const isoPath = String(args.iso || join(RUNTIME_DIR, 'pe-build', 'dsh-rescue.iso'))

if (!copype || !oscdimg) {
  const record = {
    at: nowIso(),
    steps: [],
    iso: null,
    skipped: true,
    reason: 'Windows ADK 未安装（找不到 copype.cmd / oscdimg.exe）；阶段二后置',
    adkRoots,
    workDir,
  }
  const out = writeLogJson('pe-build.json', record)
  if (args.json === true) console.log(JSON.stringify(record, null, 2))
  else console.log('[dsh-rescue] pe-build skipped → ' + out + ' (' + record.reason + ')')
  process.exit(0)
}

/** Ordered pipeline; every stage is verified on its own before the next runs. */
const plan = [
  { name: 'copype', command: copype, args: ['amd64', workDir] },
  {
    name: 'mount-image',
    command: 'dism.exe',
    args: ['/Mount-Image', '/ImageFile:' + join(workDir, 'media', 'sources', 'boot.wim'), '/Index:1', '/MountDir:' + join(workDir, 'mount')],
  },
  ...['WinPE-WMI', 'WinPE-Scripting', 'WinPE-PowerShell', 'WinPE-Fonts-Legacy'].map((name) => ({
    name: 'add-' + name,
    command: 'dism.exe',
    args: ['/Add-Package', '/ImageFile:' + join(workDir, 'media', 'sources', 'boot.wim'), '/PackagePath:' + join(workDir, 'packages', name + '.cab')],
  })),
  {
    name: 'verify-packages',
    command: 'dism.exe',
    args: ['/Get-Packages', '/ImageFile:' + join(workDir, 'media', 'sources', 'boot.wim')],
    check: (result) => /WinPE-PowerShell/iu.test(result.stdout),
  },
  {
    name: 'unmount',
    command: 'dism.exe',
    args: ['/Unmount-Image', '/MountDir:' + join(workDir, 'mount'), '/Commit'],
  },
  { name: 'make-media', command: makeMedia || oscdimg, args: makeMedia ? ['/ISO', workDir, isoPath] : [] },
]

if (args.execute !== true) {
  const record = {
    at: nowIso(),
    steps: plan.map((step) => ({ name: step.name, ok: null, elapsed: 0, command: step.command, args: step.args })),
    iso: null,
    skipped: false,
    dryRun: true,
    workDir,
    isoPath,
  }
  const out = writeLogJson('pe-build.json', record)
  if (args.json === true) console.log(JSON.stringify(record, null, 2))
  else {
    console.log('[dsh-rescue] pe-build dry run → ' + out)
    for (const step of plan) console.log('  ' + step.name + ': ' + step.command + ' ' + step.args.join(' '))
  }
  process.exit(0)
}

const steps = []
let failed = false
for (const step of plan) {
  if (failed) {
    steps.push({ name: step.name, ok: false, elapsed: 0, note: 'skipped after an earlier failure' })
    continue
  }
  const started = Date.now()
  const result = await runCapture(step.command, step.args, { timeoutMs: 1800000 })
  const ok = result.code === 0 && (typeof step.check === 'function' ? step.check(result) === true : true)
  steps.push({
    name: step.name,
    ok,
    elapsed: Date.now() - started,
    code: result.code,
    tail: String(result.stderr || result.stdout || '').trim().split(/\r?\n/u).slice(-8).join('\n'),
  })
  if (!ok) failed = true
}

const record = {
  at: nowIso(),
  steps,
  iso: failed ? null : isoPath,
  skipped: false,
  dryRun: false,
  workDir,
  isoPath,
}
const out = writeLogJson('pe-build.json', record)
if (args.json === true) console.log(JSON.stringify(record, null, 2))
else {
  console.log('[dsh-rescue] pe-build → ' + out)
  for (const step of steps) console.log('  ' + (step.ok ? 'ok  ' : 'FAIL') + ' ' + step.name + ' (' + String(step.elapsed) + 'ms)')
}
if (failed) process.exit(1)
