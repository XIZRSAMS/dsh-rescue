#!/usr/bin/env node
/**
 * P2 · provision the portable runtime.
 *
 * Puts a standalone node.exe and the DSH kernel under <repo>/runtime, then lets
 * the B-side setup render the profile. Only this script writes into runtime/;
 * the B-side files are never edited.
 */

import { cpSync, linkSync, readFileSync, readdirSync, rmdirSync, rmSync, unlinkSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'

import {
  DEFAULT_PROFILE,
  REPO_ROOT,
  RUNTIME_DIR,
  ensureDir,
  exists,
  fail,
  fileSpecifier,
  log,
  parseArgs,
  readJson,
  resolveLayers,
  warn,
  writeJson,
  writeText,
} from '../_shared.mjs'
import { diskFreeMB, linkTarget, nowIso, runCapture, sha256File, writeLogJson } from './lib/util.mjs'

const args = parseArgs()

if (args.help === true) {
  console.log(
    [
      'usage: node scripts/a/provision.mjs [options]',
      '  --kernel npm|vendor|existing   where the kernel comes from (default: config.json)',
      '  --version <x.y.z>              kernel version (default: dsh-version.json)',
      '  --vendor-dir <dir>             directory holding @deepseek-ai/dsh tarballs',
      '  --existing <dir>               full dsh package dir (with its node_modules)',
      '  --node <path>                  node.exe to copy (default: the running node)',
      '  --home <dir>                   rescue DSH_HOME (default: runtime/home)',
      '  --profile <name>               profile name (default: rescue)',
      '  --ui minimal|full              rendered UI preset',
      '  --skip-install                 skip the plugin install in setup',
      '  --force                        allow --home outside the repository',
      '  --min-disk-mb <n>              free-space floor (default: 800)',
    ].join('\n'),
  )
  process.exit(0)
}

const versionInfo = readJson(join(REPO_ROOT, 'dsh-version.json'), {})
const fileConfig = readJson(join(REPO_ROOT, 'config.json'), null) || {}
const layers = resolveLayers({ cli: args, file: fileConfig, env: process.env })

const kernelVersion = String(args.version || versionInfo.kernelVersion || '')
const kernelPackage = String(versionInfo.kernelPackage || '@deepseek-ai/dsh')
const kernelSource = String(args.kernel || layers.kernel.source || 'npm').toLowerCase()
const home = layers.home
const profile = layers.profile.name || DEFAULT_PROFILE
const ui = layers.profile.ui === 'auto' ? 'minimal' : layers.profile.ui
const minDiskMB = Number(args['min-disk-mb'] || 800)

const warnings = []
const startedAt = nowIso()

log('provision · ' + kernelPackage + '@' + kernelVersion + ' · source=' + kernelSource)
log('runtime: ' + RUNTIME_DIR)
log('home:    ' + home)

if (!['npm', 'vendor', 'existing'].includes(kernelSource)) {
  fail('--kernel must be npm|vendor|existing, got ' + JSON.stringify(kernelSource))
}
if (!kernelVersion) fail('dsh-version.json has no kernelVersion')

ensureDir(RUNTIME_DIR)

/* ── disk ───────────────────────────────────────────────────────────────── */

const free = diskFreeMB(RUNTIME_DIR)
log('disk free: ' + String(free) + ' MB (floor ' + String(minDiskMB) + ' MB)')
if (free > 0 && free < minDiskMB) {
  fail('not enough free space: ' + String(free) + ' MB < ' + String(minDiskMB) + ' MB')
}

/* ── portable node ──────────────────────────────────────────────────────── */

const nodeSource = resolve(String(args.node || process.execPath))
if (!exists(nodeSource)) fail('node executable not found: ' + nodeSource)
if (process.platform === 'win32' && !/\.exe$/iu.test(nodeSource)) {
  fail('--node must point at node.exe on Windows, got ' + nodeSource)
}

const nodeDir = join(RUNTIME_DIR, 'node')
ensureDir(nodeDir)
const nodeTarget = join(nodeDir, 'node.exe')
cpSync(nodeSource, nodeTarget)

/* runtime/node.exe keeps the literal P2 acceptance path; a hard link costs no
 * extra space on NTFS and degrades to a copy on FAT32. */
const nodeCompat = join(RUNTIME_DIR, 'node.exe')
let duplicatedNode = false
try {
  unlinkSync(nodeCompat)
} catch {
  /* absent */
}
try {
  linkSync(nodeTarget, nodeCompat)
} catch {
  cpSync(nodeTarget, nodeCompat)
  duplicatedNode = true
}

const nodeVersion = String(process.version)
if (versionInfo.nodeVersion && nodeVersion !== 'v' + String(versionInfo.nodeVersion)) {
  warnings.push('node ' + nodeVersion + ' differs from dsh-version.json (' + String(versionInfo.nodeVersion) + ')')
  warn(warnings[warnings.length - 1])
}
log('node: ' + nodeTarget + ' · ' + nodeVersion + (duplicatedNode ? ' · duplicated copy' : ' · hard link'))

/* ── kernel ─────────────────────────────────────────────────────────────── */

const kernelDir = join(RUNTIME_DIR, 'node_modules', '@deepseek-ai', 'dsh')
const kernelBin = join(kernelDir, 'lib', 'bin.js')
const runtimeManifestPath = join(RUNTIME_DIR, 'package.json')

/** Resolve an npm invocation without a shell: npm-cli.js first, cmd /c next. */
function npmCommand(argv) {
  const cli = join(dirname(process.execPath), 'node_modules', 'npm', 'bin', 'npm-cli.js')
  if (exists(cli)) return { command: process.execPath, args: [cli, ...argv] }
  if (process.platform === 'win32') {
    const cmd = join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'cmd.exe')
    return { command: cmd, args: ['/d', '/s', '/c', 'npm', ...argv] }
  }
  return { command: 'npm', args: argv }
}

async function npmInstall(extraArgs, label) {
  const invocation = npmCommand(['install', ...extraArgs, '--no-audit', '--no-fund'])
  log(label + ': npm ' + invocation.args.slice(1).join(' '))
  /* npm resolves the project from its cwd, so run inside runtime/ where the
   * generated package.json declares the pinned kernel. */
  const result = await runCapture(invocation.command, invocation.args, {
    cwd: RUNTIME_DIR,
    timeoutMs: 900000,
  })
  writeText(join(RUNTIME_DIR, 'logs', 'npm-' + label + '.out'), result.stdout)
  writeText(join(RUNTIME_DIR, 'logs', 'npm-' + label + '.err'), result.stderr)
  return result
}

if (kernelSource === 'npm') {
  writeJson(runtimeManifestPath, {
    name: 'dsh-rescue-runtime',
    private: true,
    description: 'Portable kernel tree for dsh-rescue. Generated by scripts/a/provision.mjs.',
    dependencies: { [kernelPackage]: kernelVersion },
  })

  let result = await npmInstall(['--prefix', RUNTIME_DIR], 'install')
  if (result.code !== 0) {
    warn('npm install failed; retrying with --ignore-scripts')
    result = await npmInstall(['--prefix', RUNTIME_DIR, '--ignore-scripts'], 'install-retry')
  }
  if (result.code !== 0) {
    const tail = String(result.stderr || result.stdout || '').trim().split(/\r?\n/u).slice(-10).join('\n')
    fail('npm install failed (exit ' + String(result.code) + ')\n' + tail + '\n改用 --kernel vendor 或 --kernel existing。')
  }
} else if (kernelSource === 'vendor') {
  const vendorDir = String(args['vendor-dir'] || layers.kernel.vendorDir || '')
  if (!vendorDir || !exists(vendorDir)) fail('--kernel vendor 需要 --vendor-dir <dir>')
  const tarballs = readdirSync(vendorDir).filter((name) => name.endsWith('.tgz'))
  const picked = tarballs.find((name) => name.includes(kernelVersion)) || (tarballs.length === 1 ? tarballs[0] : '')
  if (!picked) fail('在 ' + vendorDir + ' 找不到 kernel tarball（期望 *' + kernelVersion + '*.tgz）')
  const result = await npmInstall(['--prefix', RUNTIME_DIR, join(vendorDir, picked)], 'install-vendor')
  if (result.code !== 0) fail('vendor kernel install failed (exit ' + String(result.code) + ')')
} else {
  const existing = String(args.existing || layers.kernel.existing || '')
  if (!existing || !exists(existing)) fail('--kernel existing 需要 --existing <dsh 包目录>')
  const source = resolve(existing)
  const hasNodeModules = exists(join(source, 'node_modules')) || exists(join(source, 'lib', 'bin.js'))
  if (!hasNodeModules) fail(existing + ' 看起来不是完整的 dsh 安装树（缺 lib/bin.js）')
  rmSync(kernelDir, { recursive: true, force: true })
  ensureDir(dirname(kernelDir))
  cpSync(source, kernelDir, { recursive: true })
  log('kernel copied from ' + source)
}

if (!exists(kernelBin)) fail('kernel entry missing after install: ' + kernelBin)

/* Version check with the portable node itself — never trust the installer's
 * exit code alone. */
const versionRun = await runCapture(nodeTarget, [kernelBin, '--version'], {
  cwd: REPO_ROOT,
  timeoutMs: 120000,
  env: { ...process.env, DSH_HOME: home },
})
const versionText = String(versionRun.stdout || '') + String(versionRun.stderr || '')
const reported = (versionText.match(/\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?/u) || [''])[0]
if (versionRun.code !== 0 || reported !== kernelVersion) {
  fail(
    'kernel version check failed: expected ' + kernelVersion + ', got ' + JSON.stringify(reported) +
      ' (exit ' + String(versionRun.code) + ')\n' +
      String(versionText).trim().split(/\r?\n/u).slice(-8).join('\n'),
  )
}
log('kernel: ' + kernelBin + ' · ' + reported)

/* ── setup (render profile + install plugin) ────────────────────────────── */

const setupArgs = [
  join(REPO_ROOT, 'scripts', 'setup.mjs'),
  '--home',
  home,
  '--profile',
  profile,
  '--ui',
  ui,
  '--no-write-config',
]
if (args['skip-install'] === true) setupArgs.push('--no-install')
if (args.force === true) setupArgs.push('--force')

/* Deliberately inherit the caller's environment: setup refuses to write into
 * the DSH_HOME it is running under, and it sets DSH_HOME=<home> for its own
 * child processes. Overriding it here would trip that safety fence. */
const setupRun = await runCapture(nodeTarget, setupArgs, {
  cwd: REPO_ROOT,
  timeoutMs: 900000,
})
writeText(join(RUNTIME_DIR, 'logs', 'setup.out'), setupRun.stdout)
writeText(join(RUNTIME_DIR, 'logs', 'setup.err'), setupRun.stderr)
if (setupRun.code !== 0) {
  warnings.push('setup exited with code ' + String(setupRun.code) + ' (see runtime/logs/setup.err)')
  warn(warnings[warnings.length - 1])
} else {
  log('setup ok')
}

/* ── portable copy: junction → real directory ───────────────────────────── */

const profileDir = join(home, 'profiles', profile)
const pluginPath = join(profileDir, 'node_modules', 'dsh-plugin-degraded')
const profileManifestPath = join(profileDir, 'package.json')

/* pnpm rewrites a file: dependency into an absolute link: spec when it installs.
 * That breaks verify --compose and is unusable after copying the tree to a USB
 * stick (the absolute path follows the old drive). Restore the relative spec. */
let normalizedSpec = false
const profileManifest = readJson(profileManifestPath, null)
if (profileManifest && profileManifest.dependencies) {
  const currentSpec = String(profileManifest.dependencies['dsh-plugin-degraded'] || '')
  if (!currentSpec.startsWith('file:')) {
    profileManifest.dependencies['dsh-plugin-degraded'] = fileSpecifier(
      profileDir,
      join(REPO_ROOT, 'packages', 'dsh-plugin-degraded'),
    )
    writeJson(profileManifestPath, profileManifest)
    normalizedSpec = true
    log('dependency spec normalised → ' + profileManifest.dependencies['dsh-plugin-degraded'])
  }
}

let materialized = false
const pluginSpec = String(
  (profileManifest && profileManifest.dependencies && profileManifest.dependencies['dsh-plugin-degraded']) || '',
)

const linkSource = linkTarget(pluginPath)
if (!exists(pluginPath)) {
  warnings.push('plugin ' + pluginPath + ' 不存在（setup 的安装步骤可能失败）')
} else if (linkSource) {
  /* Remove the reparse point itself, never its target: unlink first, and fall
   * back to a non-recursive rmdir (a non-empty real directory refuses that). */
  try {
    unlinkSync(pluginPath)
  } catch {
    rmdirSync(pluginPath)
  }
  cpSync(linkSource, pluginPath, { recursive: true })
  materialized = true
  log('plugin materialised from ' + linkSource)
} else {
  log('plugin already a real directory')
}

/* runtime/start.cmd lives in runtime\, so %~dp0 already ends in runtime\.
 * Guard the generated launcher: node resolves to %~dp0node\node.exe and the
 * entry point to %~dp0..\scripts\entry.mjs (one level up, out of runtime). */
const generatedLauncher = join(RUNTIME_DIR, 'start.cmd')
if (exists(generatedLauncher)) {
  const text = readTextSafe(generatedLauncher)
  const nodeOk = text.includes('%~dp0node\\node.exe')
  const entryOk = text.includes('%~dp0..\\scripts\\entry.mjs')
  if (!nodeOk || !entryOk || text.includes('%~dp0runtime\\node\\node.exe')) {
    warnings.push('runtime/start.cmd 的路径层级不对：应为 %~dp0node\\node.exe 与 %~dp0..\\scripts\\entry.mjs')
  }
}

function readTextSafe(path) {
  try {
    return readFileSync(path, 'utf8')
  } catch {
    return ''
  }
}

/* ── manifest ───────────────────────────────────────────────────────────── */

const manifestOut = {
  createdAt: nowIso(),
  startedAt,
  node: {
    path: nodeTarget,
    compatPath: nodeCompat,
    sha256: sha256File(nodeTarget),
    version: nodeVersion,
    duplicatedNode,
  },
  kernel: {
    path: kernelBin,
    sha256: sha256File(kernelBin),
    version: reported,
    source: kernelSource,
  },
  plugin: {
    path: pluginPath,
    spec: pluginSpec,
    materialized,
    normalizedSpec,
  },
  home,
  profile,
  ui,
  warnings,
}

const manifestPath = writeLogJson('manifest.json', manifestOut)
log('manifest: ' + manifestPath)
for (const warning of warnings) warn(warning)
