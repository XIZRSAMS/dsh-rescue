#!/usr/bin/env node
/**
 * dsh-rescue · A-side launcher
 *
 * scripts/entry.mjs hands the original argv here as soon as this file exists.
 * The launcher owns argv resolution (parseArgs + resolveLayers) and kernel
 * discovery; everything after that is a plain spawn of the kernel with
 * stdio inherited, so Ctrl+C and exit codes keep working.
 *
 * Rescue-only flags (--ui, --open, --home, --kernel, ...) are consumed here and
 * never reach the kernel. The kernel's web app understands --host, --port and
 * --trusted-host only.
 */

import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { join } from 'node:path'

import { REPO_ROOT, RUNTIME_DIR, parseArgs, readJson, resolveLayers } from '../scripts/_shared.mjs'
import { buildLauncherArgs, locateKernel, usageText } from '../scripts/a/lib/launch-core.mjs'

const argv = process.argv.slice(2)
const args = parseArgs(argv)

if (args.help === true || argv.includes('-h') || argv.includes('--help')) {
  console.log(usageText())
  process.exit(0)
}

/* Everything after a bare -- belongs to the booted app. */
const separator = argv.indexOf('--')
const passthrough = separator === -1 ? [] : argv.slice(separator + 1)

const fileConfig = readJson(join(REPO_ROOT, 'config.json'), null) || {}
const layers = resolveLayers({ cli: args, file: fileConfig, env: process.env })

/* Full overlay: the rendered one wins; the template is the fallback. */
const overlayCandidates = [join(RUNTIME_DIR, 'full.patch.yml'), join(REPO_ROOT, 'profiles', 'full.patch.yml')]
const overlay = overlayCandidates.find((candidate) => existsSync(candidate))
if (layers.profile.ui === 'full' && !overlay) {
  console.error('[dsh-rescue] warn: ui=full but no full overlay was found (runtime/full.patch.yml or profiles/full.patch.yml)')
}

const kernel = locateKernel({ runtimeDir: RUNTIME_DIR, env: process.env })
if (!kernel) {
  const versionInfo = readJson(join(REPO_ROOT, 'dsh-version.json'), {})
  console.error(
    [
      '[dsh-rescue] 找不到 kernel（@deepseek-ai/dsh）。',
      '先运行: node scripts/a/provision.mjs          （npm 安装便携 kernel，需要网络）',
      '或:     node scripts/setup.mjs --kernel vendor --vendor-dir <tgz 目录>',
      '也可以设置 DSH_RESCUE_KERNEL_BIN 指向已有的 dsh/lib/bin.js。',
      '期望位置: ' + join(RUNTIME_DIR, 'node_modules', '@deepseek-ai', 'dsh', 'lib', 'bin.js'),
      '目标版本: ' + String(versionInfo.kernelVersion || '未声明'),
    ].join('\n'),
  )
  process.exit(2)
}

const launcherArgs = buildLauncherArgs({ layers, overlay, passthrough })
const env = { ...process.env, DSH_HOME: layers.home }

const child = spawn(process.execPath, ['--use-system-ca', kernel, ...launcherArgs], {
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
