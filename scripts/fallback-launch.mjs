#!/usr/bin/env node
/**
 * dsh-rescue · fallback launcher
 *
 * Launches the DSH kernel when the A-side `src/launch.mjs` is not present yet.
 * Resolution order for the kernel:
 *
 *   1. DSH_RESCUE_KERNEL_BIN   explicit path to dsh/lib/bin.js
 *   2. <repo>/runtime/node_modules/@deepseek-ai/dsh/lib/bin.js
 *   3. <repo>/runtime/dsh/lib/bin.js
 *   4. `dsh` on PATH
 *
 * Everything the launcher needs is already in the environment (entry.mjs set
 * DSH_HOME and the rescue variables), so this file only builds argv.
 */

import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { join } from 'node:path'

import { DEFAULT_PROFILE, REPO_ROOT, RUNTIME_DIR, parseArgs, readJson } from './_shared.mjs'

const args = parseArgs()
const versionInfo = readJson(join(REPO_ROOT, 'dsh-version.json'), {})

const profile = String(process.env.DSH_RESCUE_PROFILE || args.profile || DEFAULT_PROFILE)
const host = String(args.host || process.env.DSH_RESCUE_HOST || '127.0.0.1')
const port = String(args.port || process.env.DSH_RESCUE_PORT || '3080')
const noOpen = args.open === true ? false : true

const home = String(process.env.DSH_RESCUE_HOME || join(RUNTIME_DIR, 'home'))
const env = { ...process.env, DSH_HOME: home }

/** Locate a kernel entry (`.../dsh/lib/bin.js`). */
function locateKernel() {
  const candidates = [
    process.env.DSH_RESCUE_KERNEL_BIN,
    join(RUNTIME_DIR, 'node_modules', '@deepseek-ai', 'dsh', 'lib', 'bin.js'),
    join(RUNTIME_DIR, 'dsh', 'lib', 'bin.js'),
  ].filter(Boolean)
  for (const candidate of candidates) {
    if (candidate && existsSync(candidate)) return { kind: 'js', path: candidate }
  }
  return undefined
}

const kernel = locateKernel()
if (!kernel) {
  console.error(
    [
      '[dsh-rescue] 找不到 kernel（@deepseek-ai/dsh）。',
      `期望位置: ${join(RUNTIME_DIR, 'node_modules', '@deepseek-ai', 'dsh', 'lib', 'bin.js')}`,
      `先运行: node scripts/setup.mjs --kernel npm   （需要网络）`,
      `或:     node scripts/setup.mjs --kernel vendor --vendor-dir <tgz 目录>`,
      `也可以设置 DSH_RESCUE_KERNEL_BIN 指向已有的 dsh/lib/bin.js。`,
      `目标版本: ${versionInfo.kernelVersion || '未声明'}`,
    ].join('\n'),
  )
  process.exit(2)
}

const launcherArgs = ['--profile', profile]
if (process.env.DSH_RESCUE_UI === 'full') {
  // setup.mjs renders runtime/full.patch.yml from profiles/full.patch.yml and
  // only lists decoration rows that are actually installed.
  const rendered = join(RUNTIME_DIR, 'full.patch.yml')
  const template = join(REPO_ROOT, 'profiles', 'full.patch.yml')
  const overlay = existsSync(rendered) ? rendered : template
  if (existsSync(overlay)) launcherArgs.push('--patch', overlay)
}
launcherArgs.push('--host', host, '--port', port)
if (noOpen) launcherArgs.push('--no-open')

const child = spawn(process.execPath, ['--use-system-ca', kernel.path, ...launcherArgs], {
  env,
  stdio: 'inherit',
  cwd: process.cwd(),
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
  console.error('[dsh-rescue] kernel launch failed:', String((error && error.message) || error))
  process.exit(1)
})

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => {
    try {
      child.kill(signal)
    } catch {
      /* already gone */
    }
  })
}
