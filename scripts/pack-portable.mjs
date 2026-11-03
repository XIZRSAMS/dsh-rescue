#!/usr/bin/env node
/**
 * Assemble a self-contained folder that can be copied to a USB stick and run
 * from either a normal Windows install or a WinPE session.
 *
 *   node scripts/pack-portable.mjs [--out dist/portable]
 *
 * The output contains: runtime/node (node + kernel), the plugin, the scripts,
 * a freshly rendered runtime/home/profile, the tray launcher, and start.cmd.
 * Nothing machine-specific is copied: runtime/home is rendered from scratch.
 */

import { cpSync, existsSync, mkdirSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { join, relative } from 'node:path'
import { spawnSync } from 'node:child_process'

import { REPO_ROOT } from './_shared.mjs'

const args = process.argv.slice(2)
const outArg = args.indexOf('--out')
const outRoot = outArg >= 0 ? args[outArg + 1] : join(REPO_ROOT, 'dist', 'portable')

/* npm creates a self-link runtime/node_modules/dsh-rescue-runtime -> runtime/;
 * dereferencing it would copy the whole runtime into itself. Skip that name. */
const SELF_LINK = 'dsh-rescue-runtime'

function copy(src, dest) {
  if (!existsSync(src)) return false
  cpSync(src, dest, {
    recursive: true,
    dereference: true,
    filter: (source) => !source.endsWith(SELF_LINK),
  })
  return true
}

function sizeOf(dir) {
  let total = 0
  const walk = (current) => {
    for (const entry of readdirSync(current, { withFileTypes: true })) {
      const full = join(current, entry.name)
      if (entry.isDirectory()) walk(full)
      else if (entry.isFile()) total += statSync(full).size
    }
  }
  walk(dir)
  return total
}

console.log('[pack] out = ' + outRoot)
rmSync(outRoot, { recursive: true, force: true })
mkdirSync(outRoot, { recursive: true })

const required = [
  ['runtime/node', 'runtime/node'],
  ['runtime/node.exe', 'runtime/node.exe'],
  ['runtime/node_modules', 'runtime/node_modules'],
  ['packages/dsh-plugin-degraded', 'packages/dsh-plugin-degraded'],
  ['scripts', 'scripts'],
  ['src', 'src'],
  ['profiles', 'profiles'],
  ['launcher', 'launcher'],
  ['start.cmd', 'start.cmd'],
  ['start.sh', 'start.sh'],
  ['dsh-version.json', 'dsh-version.json'],
  ['config.example.json', 'config.example.json'],
  ['LICENSE', 'LICENSE'],
  ['README.md', 'README.md'],
  ['README.zh.md', 'README.zh.md'],
  ['dist/dsh-rescue.exe', 'dsh-rescue.exe'],
]

for (const [from, to] of required) {
  const ok = copy(join(REPO_ROOT, from), join(outRoot, to))
  if (!ok) console.log('[pack] skip (missing): ' + from)
}

/* The profile resolves its plugin through node_modules; setup renders the
 * manifest but never installs, so carry the materialised plugin tree over.
 * runtime/home itself is NOT copied (it holds credentials and sessions). */
mkdirSync(join(outRoot, 'runtime', 'home', 'profiles', 'rescue'), { recursive: true })
copy(
  join(REPO_ROOT, 'runtime', 'home', 'profiles', 'rescue', 'node_modules'),
  join(outRoot, 'runtime', 'home', 'profiles', 'rescue', 'node_modules'),
)

mkdirSync(join(outRoot, 'runtime', 'logs'), { recursive: true })
mkdirSync(join(outRoot, 'runtime', 'tmp'), { recursive: true })

/* Render a clean profile inside the package so the first run needs no network. */
const setup = spawnSync(
  process.execPath,
  [join(outRoot, 'scripts', 'setup.mjs'), '--home', join(outRoot, 'runtime', 'home'), '--no-install', '--no-write-config'],
  { cwd: outRoot, encoding: 'utf8' },
)
if (setup.status !== 0) {
  console.error(setup.stdout || '')
  console.error(setup.stderr || '')
  process.exit(1)
}

const notes = [
  'dsh-rescue portable package',
  '',
  'Windows: 双击 dsh-rescue.exe（托盘 + 自动开浏览器）或 start.cmd',
  'WinPE:   在 PE 里打开命令行，进入本目录执行 start.cmd',
  '         浏览器在别的设备上：手机连同一局域网，访问打印出来的 http://<IP>:3080/',
  '',
  'DSH_HOME 默认 = 本目录 runtime\\home（可以整个文件夹带走）',
  '日志 = runtime\\logs',
].join('\r\n')
writeFileSync(join(outRoot, '使用说明.txt'), notes, 'utf8')

const bytes = sizeOf(outRoot)
console.log('[pack] done, ' + (bytes / 1024 / 1024).toFixed(1) + ' MB at ' + outRoot)
