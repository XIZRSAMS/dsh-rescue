#!/usr/bin/env node
/**
 * dsh-rescue · upgrade
 *
 * The only file that changes when the upstream kernel moves is dsh-version.json:
 *
 *   node scripts/upgrade.mjs --to 0.2.0-rc.3
 *
 * Steps: back up the generated files → rewrite the version → re-run setup →
 * verify --compose → roll back on any failure.
 */

import { cpSync, rmSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { join } from 'node:path'

import {
  REPO_ROOT,
  RUNTIME_DIR,
  exists,
  fail,
  log,
  parseArgs,
  readJson,
  readText,
  warn,
  writeJson,
  writeText,
} from './_shared.mjs'

const args = parseArgs()
const versionPath = join(REPO_ROOT, 'dsh-version.json')
const current = readJson(versionPath, null)
if (!current) fail(`cannot read ${versionPath}`)

const target = String(args.to || args.version || current.kernelVersion || '')
if (!target) fail('usage: node scripts/upgrade.mjs --to <kernel-version>')

if (target === current.kernelVersion) {
  log(`already at ${target}; re-running setup to re-verify`)
}

const stamp = new Date().toISOString().replace(/[:.]/gu, '-')
const backupDir = join(RUNTIME_DIR, `.backup-${stamp}`)

/** Files rewritten by setup; restored verbatim when verification fails. */
const generated = [
  'dsh-version.json',
  'config.json',
  'runtime/home/profiles/rescue/package.json',
  'runtime/home/profiles/rescue/cordis.patch.yml',
  'runtime/start.cmd',
  'runtime/start.sh',
]

function backup() {
  const saved = {}
  for (const relativePath of generated) {
    const absolute = join(REPO_ROOT, relativePath)
    if (exists(absolute)) saved[relativePath] = readText(absolute)
  }
  return saved
}

function restore(saved) {
  for (const [relativePath, text] of Object.entries(saved)) {
    writeText(join(REPO_ROOT, relativePath), text)
  }
  for (const relativePath of generated) {
    if (!(relativePath in saved)) {
      const absolute = join(REPO_ROOT, relativePath)
      try {
        rmSync(absolute, { force: true })
      } catch {
        /* ignore */
      }
    }
  }
}

const saved = backup()

if (args['dry-run'] === true) {
  log(`dry run: ${current.kernelVersion} → ${target}`)
  process.exit(0)
}

writeJson(versionPath, { ...current, kernelVersion: target })
log(`dsh-version.json: ${current.kernelVersion} → ${target}`)

const setupArgs = [join(REPO_ROOT, 'scripts', 'setup.mjs')]
if (args.ui) setupArgs.push('--ui', String(args.ui))
if (args.install === false) setupArgs.push('--no-install')

const setup = spawnSync(process.execPath, setupArgs, { stdio: 'inherit', cwd: REPO_ROOT })
if (setup.status !== 0) {
  restore(saved)
  fail(`setup failed for ${target}; rolled back to ${current.kernelVersion}`)
}

const verify = spawnSync(process.execPath, [join(REPO_ROOT, 'scripts', 'verify.mjs'), '--compose'], {
  stdio: 'inherit',
  cwd: REPO_ROOT,
})
if (verify.status !== 0) {
  restore(saved)
  fail(`verify failed for ${target}; rolled back to ${current.kernelVersion}`)
}

try {
  cpSync(versionPath, join(backupDir, 'dsh-version.json'), { recursive: true })
} catch {
  /* backup is best effort */
}

warn('只改了 dsh-version.json + 重跑 setup；请按验收清单手动确认：start.cmd 能起、/rescue 有报告、minimal 无装饰。')
log(`upgrade to ${target} verified`)
