#!/usr/bin/env node
/**
 * dsh-rescue · setup
 *
 * Idempotent: renders <runtime>/home/profiles/<name>/ from the templates in
 * profiles/, installs the plugin (best effort), generates start.cmd, validates
 * the composed profile and writes an environment report.
 *
 * Safety rule: this script only ever writes inside <repo>/runtime (or an
 * explicitly forced path). It refuses to touch the DSH_HOME of the running
 * session, so the Harness you are using right now cannot be damaged by it.
 */

import { spawnSync } from 'node:child_process'
import { readdirSync } from 'node:fs'
import { join } from 'node:path'

import {
  DEFAULT_HOME,
  DEFAULT_PROFILE,
  REPO_ROOT,
  RUNTIME_DIR,
  ensureDir,
  fail,
  fileSpecifier,
  isInside,
  log,
  parseArgs,
  readJson,
  readText,
  resolveLayers,
  table,
  warn,
  writeJson,
  writeText,
} from './_shared.mjs'
import { decideThisMachine, reportThisMachine } from './_probe.mjs'

const args = parseArgs()
const dryRun = args['dry-run'] === true
const noInstall = args.install === false || dryRun

/* ── version + config layers ────────────────────────────────────────────── */

const versionInfo = readJson(join(REPO_ROOT, 'dsh-version.json'), {})
if (!versionInfo.kernelVersion) fail('dsh-version.json is missing kernelVersion')

const configPath = join(REPO_ROOT, 'config.json')
const fileConfig = readJson(configPath, null)
const layers = resolveLayers({ cli: args, file: fileConfig || {} })

if (!['minimal', 'full', 'auto'].includes(layers.profile.ui)) {
  fail(`ui must be minimal|full|auto, got ${JSON.stringify(layers.profile.ui)}`)
}

const profileName = layers.profile.name
const home = layers.home
const profileDir = join(home, 'profiles', profileName)
const packagesRoot = join(REPO_ROOT, 'packages')

/* ── safety fence ───────────────────────────────────────────────────────── */

if (process.env.DSH_HOME && isInside(home, process.env.DSH_HOME)) {
  fail(
    [
      `拒绝写入 ${home}`,
      '这个路径在当前 DSH_HOME 里面——那是正在使用的 Harness，不属于本次救援安装。',
      '用 --home 指定一个独立目录（默认就是 <repo>/runtime/home）。',
    ].join('\n'),
  )
}

const forced = args.force === true
if (!isInside(home, REPO_ROOT) && !forced) {
  fail(
    [
      `拒绝写入仓库外的路径 ${home}`,
      'dsh-rescue 只管理自己的 runtime 目录。要在 U 盘/PE 上安装，请显式加 --force。',
    ].join('\n'),
  )
}

/* ── templates ──────────────────────────────────────────────────────────── */

const templates = {
  profileManifest: join(REPO_ROOT, 'profiles', 'package.json'),
  webDesktopPatch: join(REPO_ROOT, 'profiles', 'web-desktop.patch.yml'),
  minimalPatch: join(REPO_ROOT, 'profiles', 'minimal.patch.yml'),
  fullPatch: join(REPO_ROOT, 'profiles', 'full.patch.yml'),
  decorations: join(REPO_ROOT, 'profiles', 'decorations.json'),
}

const profileManifest = readJson(templates.profileManifest, null)
if (!profileManifest) fail(`cannot read ${templates.profileManifest}`)

const webDesktopPatch = readText(templates.webDesktopPatch)
const minimalPatch = readText(templates.minimalPatch)
const fullPatch = readText(templates.fullPatch)
if (!webDesktopPatch || !minimalPatch || !fullPatch) fail('profiles/*.patch.yml templates are incomplete')

const decorations = readJson(templates.decorations, { decorations: [] }).decorations || []

const profileManifestOut = {
  ...profileManifest,
  dependencies: {
    ...(profileManifest.dependencies || {}),
    'dsh-plugin-degraded': fileSpecifier(profileDir, join(packagesRoot, 'dsh-plugin-degraded')),
  },
}

/* ── render ─────────────────────────────────────────────────────────────── */

/** Restate the plugin config with the chosen preset (a patch replaces the whole config). */
function renderWebDesktop(text) {
  const rendered = text.replace(/^(\s*)ui: auto$/mu, `$1ui: ${layers.profile.ui}`)
  if (rendered === text && layers.profile.ui !== 'auto') {
    warn('profiles/web-desktop.patch.yml 没有 `ui: auto` 占位行，preset 未写入 profile 层')
  }
  return rendered
}

/**
 * Package names present in the profile. A decoration row is emitted only for an
 * installed package: patching a row that does not exist produces "entry not
 * found" noise and makes `--dump-config` exit non-zero.
 */
function installedPackageNames(nodeModulesDir) {
  const names = new Set(Object.keys(profileManifestOut.dependencies || {}))
  let entries
  try {
    entries = readdirSync(nodeModulesDir, { withFileTypes: true })
  } catch {
    return names
  }
  for (const entry of entries) {
    if (!entry.isDirectory()) continue
    if (!entry.name.startsWith('@')) {
      names.add(entry.name)
      continue
    }
    try {
      for (const sub of readdirSync(join(nodeModulesDir, entry.name), { withFileTypes: true })) {
        if (sub.isDirectory()) names.add(`${entry.name}/${sub.name}`)
      }
    } catch {
      /* scoped dir unreadable */
    }
  }
  return names
}

const renderedWebDesktop = renderWebDesktop(webDesktopPatch)
const installedPackages = installedPackageNames(join(profileDir, 'node_modules'))
const installedDecorations = decorations.filter((entry) => installedPackages.has(entry.package))

const decorationRows = (disabled) =>
  installedDecorations.map((entry) => `- id: ${entry.rowId}\n  disabled: ${disabled}`).join('\n')

const decorationLayer = layers.profile.ui === 'full' ? fullPatch : minimalPatch
const profilePatchText = [
  '# generated by scripts/setup.mjs — edit profiles/*.patch.yml, then re-run setup',
  renderedWebDesktop.trimEnd(),
  '',
  decorationLayer.trimEnd(),
  '',
  '# ── installed decoration packages (auto-detected) ──────────────────────',
  installedDecorations.length > 0
    ? decorationRows(layers.profile.ui === 'full' ? 'false' : 'true')
    : '# none installed',
  '',
].join('\n')

/** The overlay `start.cmd --ui full` passes to the kernel. */
const fullOverlayText = [
  '# generated by scripts/setup.mjs — edit profiles/full.patch.yml, then re-run setup',
  fullPatch.trimEnd(),
  '',
  '# ── installed decoration packages (auto-detected) ──────────────────────',
  installedDecorations.length > 0 ? decorationRows('false') : '# none installed',
  '',
].join('\n')

const pnpmWorkspace = ['packages:', '  - .', '', 'nodeLinker: hoisted', 'autoInstallPeers: false', ''].join('\n')

const cordisRoot = [
  '# dsh profile root — an empty entry list. The tree is composed from patches:',
  '# bundle patches (package.json dsh.profile.bundles), then cordis.patch.yml, then --patch overlays.',
  '[]',
  '',
].join('\n')

const startCmd = [
  '@echo off',
  'rem generated by scripts/setup.mjs — do not edit',
  'setlocal',
  `set "DSH_HOME=${home}"`,
  `set "DSH_RESCUE_PROFILE=${profileName}"`,
  `set "DSH_RESCUE_VERSION=${versionInfo.kernelVersion}"`,
  'if not defined DSH_RESCUE_UI set "DSH_RESCUE_UI=minimal"',
  'set "NODE_EXE=node"',
  'if exist "%~dp0node\\node.exe" set "NODE_EXE=%~dp0node\\node.exe"',
  '"%NODE_EXE%" "%~dp0..\\scripts\\entry.mjs" %*',
  'exit /b %ERRORLEVEL%',
  '',
].join('\r\n')

const startSh = [
  '#!/usr/bin/env sh',
  '# generated by scripts/setup.mjs — do not edit',
  `export DSH_HOME="${home}"`,
  `export DSH_RESCUE_PROFILE="${profileName}"`,
  `export DSH_RESCUE_VERSION="${versionInfo.kernelVersion}"`,
  ': "${DSH_RESCUE_UI:=minimal}"',
  'export DSH_RESCUE_UI',
  `exec node "${join(REPO_ROOT, 'scripts', 'entry.mjs')}" "$@"`,
  '',
].join('\n')

/* ── plan output ────────────────────────────────────────────────────────── */

const plan = [
  ['repo', REPO_ROOT],
  ['home', home],
  ['profile', profileName],
  ['ui preset', layers.profile.ui],
  ['kernel', `${versionInfo.kernelPackage || '@deepseek-ai/dsh'}@${versionInfo.kernelVersion}`],
  ['kernel source', layers.kernel.source],
  ['plugin spec', profileManifestOut.dependencies['dsh-plugin-degraded']],
]

if (dryRun) {
  log('dry run — nothing is written')
  console.log(table(plan))
  console.log('\n--- profiles/' + profileName + '/cordis.patch.yml ---\n')
  console.log(profilePatchText)
  process.exit(0)
}

/* ── write ──────────────────────────────────────────────────────────────── */

ensureDir(profileDir)
ensureDir(join(RUNTIME_DIR, 'logs'))

writeJson(join(profileDir, 'package.json'), profileManifestOut)
writeText(join(profileDir, 'cordis.yml'), cordisRoot)
writeText(join(profileDir, 'cordis.patch.yml'), profilePatchText)
writeText(join(profileDir, 'pnpm-workspace.yaml'), pnpmWorkspace)
writeText(join(RUNTIME_DIR, 'full.patch.yml'), fullOverlayText)
// Machine-specific launchers live in runtime/; the committed start.cmd at the
// repository root is static and path-free.
writeText(join(RUNTIME_DIR, 'start.cmd'), startCmd)
writeText(join(RUNTIME_DIR, 'start.sh'), startSh)

const writeConfig = args['write-config'] !== false
if (writeConfig) {
  writeJson(join(REPO_ROOT, 'config.json'), {
    ...(fileConfig || {}),
    profile: { name: profileName, ui: layers.profile.ui },
    server: { host: layers.server.host, port: Number(layers.server.port) || 3080, trustedHosts: [], openBrowser: layers.server.openBrowser },
    kernel: layers.kernel,
    capabilities: layers.capabilities,
    report: layers.report,
  })
}

log('wrote', profileDir)

/* ── install (best effort) ──────────────────────────────────────────────── */

function findDshCli() {
  if (process.env.DSH_BIN) return process.env.DSH_BIN
  for (const candidate of [
    join(REPO_ROOT, 'runtime', 'node_modules', '@deepseek-ai', 'dsh', 'lib', 'bin.js'),
    join(REPO_ROOT, 'runtime', 'node_modules', '.bin', 'dsh.cmd'),
    join(REPO_ROOT, 'runtime', 'node_modules', '.bin', 'dsh'),
  ]) {
    if (readText(candidate) !== '' || readJson(candidate, null)) return candidate
  }
  const which = process.platform === 'win32' ? 'where' : 'which'
  const probe = spawnSync(which, ['dsh'], { encoding: 'utf8' })
  if (probe.status === 0) {
    const first = String(probe.stdout || '')
      .split(/\r?\n/u)
      .map((line) => line.trim())
      .filter(Boolean)[0]
    if (first) return first
  }
  return undefined
}

const dshCli = findDshCli()

if (noInstall) {
  log('install skipped (--no-install / --dry-run)')
} else if (!dshCli) {
  warn('找不到 dsh 可执行文件；跳过插件安装。装好 kernel 后重跑 setup，或设置 DSH_BIN。')
} else {
  const isJs = dshCli.endsWith('.js')
  const command = isJs ? process.execPath : dshCli
  const prefix = isJs ? [dshCli] : []
  const result = spawnSync(
    command,
    [...prefix, 'plugin', '--profile', profileName, 'add', join(packagesRoot, 'dsh-plugin-degraded')],
    { encoding: 'utf8', timeout: 300_000, env: { ...process.env, DSH_HOME: home } },
  )
  if (result.status === 0) {
    log('plugin installed into the profile')
  } else {
    warn('dsh plugin add 失败，回退到 pnpm/npm')
    const manager = spawnSync(process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm', ['--version'], { encoding: 'utf8' })
    const tool = manager.status === 0 ? (process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm') : process.platform === 'win32' ? 'npm.cmd' : 'npm'
    const fallback = spawnSync(tool, ['install', '--dir', profileDir], {
      encoding: 'utf8',
      timeout: 300_000,
      cwd: profileDir,
      env: { ...process.env, DSH_HOME: home },
    })
    if (fallback.status === 0) log(`installed with ${tool}`)
    else warn(String(fallback.stderr || fallback.stdout || '').trim().split(/\r?\n/u).slice(-5).join('\n'))
  }
}

/* ── validate the composed tree ─────────────────────────────────────────── */

if (dshCli && !noInstall) {
  const isJs = dshCli.endsWith('.js')
  const result = spawnSync(
    isJs ? process.execPath : dshCli,
    [...(isJs ? [dshCli] : []), '--profile', profileName, '--dump-config'],
    { encoding: 'utf8', timeout: 120_000, env: { ...process.env, DSH_HOME: home } },
  )
  const composed = join(RUNTIME_DIR, 'logs', 'composed.yml')
  if (result.status === 0) {
    writeText(composed, String(result.stdout || ''))
    log('dump-config ok →', composed)
  } else {
    warn('dump-config 失败：')
    warn(String(result.stderr || result.stdout || '').trim().split(/\r?\n/u).slice(-12).join('\n'))
  }
}

/* ── environment report ─────────────────────────────────────────────────── */

const probe = decideThisMachine(
  {
    shell: layers.capabilities.shell,
    // The rendered profile layer is authoritative: report what will actually boot.
    ui: layers.profile.ui === 'auto' ? layers.capabilities.ui : layers.profile.ui,
    terminal: layers.capabilities.terminal,
    image: layers.capabilities.image,
    report: layers.report,
  },
  {},
  { dshRoot: join(RUNTIME_DIR, 'node_modules') },
)

const report = reportThisMachine(probe, {
  rescueVersion: versionInfo.rescueVersion || '0.1.0',
  profile: profileName,
})

writeJson(join(RUNTIME_DIR, 'capabilities.json'), report.json)
writeText(join(RUNTIME_DIR, 'logs', 'report.txt'), report.text)
writeJson(join(RUNTIME_DIR, 'last-setup.json'), {
  at: new Date().toISOString(),
  kernelVersion: versionInfo.kernelVersion,
  profile: profileName,
  ui: layers.profile.ui,
  home,
})

console.log('')
console.log(report.text)
console.log('')
log(table(plan))
log('next: start.cmd --host <LAN-IP>  (or start.cmd for loopback only)')
