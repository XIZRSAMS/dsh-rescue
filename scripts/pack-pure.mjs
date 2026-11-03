#!/usr/bin/env node
/**
 * Assemble a PURE official-kernel folder for WinPE bring-up.
 *
 *   node scripts/pack-pure.mjs [--out dist/pure]
 *
 * No dsh-rescue plugin, no custom profile layer: only @deepseek-ai/dsh-base +
 * @deepseek-ai/dsh-web-app, exactly as the official CLI would compose them.
 * Ships two PE helpers: pe-probe.cmd (collect evidence) and start-dsh.cmd.
 */

import { cpSync, existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { join } from 'node:path'

import { REPO_ROOT } from './_shared.mjs'

const args = process.argv.slice(2)
const outArg = args.indexOf('--out')
const out = outArg >= 0 ? args[outArg + 1] : join(REPO_ROOT, 'dist', 'pure')

/* npm links runtime/node_modules/dsh-rescue-runtime back to runtime/; copying it
 * with dereference would duplicate the whole tree. */
const SELF_LINK = 'dsh-rescue-runtime'
function copy(src, dest) {
  if (!existsSync(src)) return false
  cpSync(src, dest, { recursive: true, dereference: true, filter: (s) => !s.endsWith(SELF_LINK) })
  return true
}

const haveBrowser = existsSync(join(REPO_ROOT, 'dist', 'palemoon-official', 'Palemoon-Portable.exe'))
const havePwsh = existsSync(join(REPO_ROOT, 'dist', 'pwsh7', 'pwsh.exe'))
console.log('[pure] out = ' + out)
if (!haveBrowser) console.log('[pure] note: dist/palemoon-official missing -> package ships without a browser (see docs/pe-runbook.md)')
if (!havePwsh) console.log('[pure] note: dist/pwsh7 missing -> package ships without PowerShell')
rmSync(out, { recursive: true, force: true })
mkdirSync(out, { recursive: true })

/* Optional bundled browser: an official Pale Moon portable tree, unpacked under
 * dist/palemoon-official (see docs/pe-notes.md). Ships only when present. */
if (existsSync(join(REPO_ROOT, 'dist', 'palemoon-official'))) {
  copy(join(REPO_ROOT, 'dist', 'palemoon-official'), join(out, 'browser'))
}

copy(join(REPO_ROOT, 'runtime', 'node'), join(out, 'runtime', 'node'))
copy(join(REPO_ROOT, 'runtime', 'node_modules'), join(out, 'runtime', 'node_modules'))
mkdirSync(join(out, 'runtime', 'tmp'), { recursive: true })
mkdirSync(join(out, 'runtime', 'logs'), { recursive: true })

/* Official-only profile: two bundles, nothing else. */
const profileDir = join(out, 'runtime', 'home', 'profiles', 'web')
mkdirSync(profileDir, { recursive: true })
writeFileSync(
  join(profileDir, 'package.json'),
  JSON.stringify(
    {
      name: 'dsh-profile-web',
      private: true,
      description: 'Pure official profile: dsh-base + dsh-web-app only.',
      dsh: { profile: { bundles: ['@deepseek-ai/dsh-base', '@deepseek-ai/dsh-web-app'] } },
    },
    null,
    2,
  ) + '\n',
)
writeFileSync(join(profileDir, 'cordis.yml'), '[]\n')

/* The PE launcher lives in launcher/pe-start.cmd so it is edited in one place. */
copy(join(REPO_ROOT, 'launcher', 'pe-start.cmd'), join(out, 'start-dsh.cmd'))
copy(join(REPO_ROOT, 'launcher', 'PE-测试流程.txt'), join(out, '测试流程.txt'))

/* PE rescue skills land in $DSH_HOME/skills, the provider's default root. */
copy(join(REPO_ROOT, 'launcher', 'skills'), join(out, 'runtime', 'home', 'skills'))


writeFileSync(
  join(out, 'pe-probe.cmd'),
  [
    '@echo off',
    'rem Collect WinPE evidence into logs\\pe-probe.txt and show it on screen.',
    'setlocal enabledelayedexpansion',
    'set "ROOT=%~dp0"',
    'if not exist "%ROOT%logs" mkdir "%ROOT%logs" 2>nul',
    'set "LOG=%ROOT%logs\\pe-probe.txt"',
    'set "NODE=%ROOT%runtime\\node\\node.exe"',
    'if not exist "%NODE%" set "NODE=node"',
    'set "TMP=%ROOT%runtime\\tmp"',
    'set "TEMP=%ROOT%runtime\\tmp"',
    '',
    'echo === dsh-rescue PE probe === > "%LOG%"',
    'echo date: %DATE% %TIME% >> "%LOG%"',
    'echo windir: %WINDIR% >> "%LOG%"',
    'echo tmp: %TMP% >> "%LOG%"',
    'echo. >> "%LOG%"',
    'echo --- node -v >> "%LOG%"',
    '"%NODE%" -v >> "%LOG%" 2>&1',
    'echo --- requires (fs/os/net/http) >> "%LOG%"',
    '"%NODE%" -e "console.log(\"arith\",1+1);console.log(\"os\",require(\"os\").platform(),require(\"os\").release());require(\"fs\");require(\"net\");require(\"http\");require(\"crypto\");console.log(\"modules ok\")" >> "%LOG%" 2>&1',
    'echo --- crypto rng >> "%LOG%"',
    '"%NODE%" -e "console.log(require(\"crypto\").randomBytes(8).toString(\"hex\"))" >> "%LOG%" 2>&1',
    'echo --- http listen >> "%LOG%"',
    '"%NODE%" -e "const s=require(\"http\").createServer((q,r)=>r.end(\"ok\"));s.listen(0,\"127.0.0.1\",()=>{console.log(\"listen\",s.address().port);s.close()})" >> "%LOG%" 2>&1',
    'echo --- fs write >> "%LOG%"',
    '"%NODE%" -e "require(\"fs\").writeFileSync(process.env.TMP+\"\\\\probe.txt\",\"x\");console.log(\"fs write ok\")" >> "%LOG%" 2>&1',
    'echo --- ipconfig >> "%LOG%"',
    'ipconfig >> "%LOG%" 2>&1',
    'echo. >> "%LOG%"',
    'type "%LOG%"',
    'echo.',
    'echo saved: %LOG%',
    'pause',
  ].join('\r\n'),
  'utf8',
)

writeFileSync(
  join(out, '使用说明.txt'),
  [
    'dsh-pure · 官方内核纯净包（给 WinPE 验证用）',
    '',
    '1. 在 PE 里进到本目录，先跑 pe-probe.cmd（收集 node 能否启动的证据，结果写 logs\\pe-probe.txt）',
    '2. 探针通过后再跑 start-dsh.cmd（起官方 kernel，打印局域网地址）',
    '3. 手机连同一网络，打开 http://<打印出来的IP>:3080/?token=<屏幕上的token>',
    '',
    '没有任何自定义插件；profile 只声明 @deepseek-ai/dsh-base + @deepseek-ai/dsh-web-app。',
    '日志：runtime\\logs；临时目录已钉到 runtime\\tmp（PE 的 %TMP% 常常不可写）。',
  ].join('\r\n'),
  'utf8',
)

/* Old engines (Pale Moon/Goanna) miss AbortSignal.any; patch the client bundle. */
const patchRun = spawnSync(process.execPath, [join(REPO_ROOT, 'scripts', 'patch-pe-polyfill.mjs'), '--root', out], { encoding: 'utf8' })
if (patchRun.status !== 0) {
  console.error(patchRun.stdout || '')
  console.error(patchRun.stderr || '')
  process.exit(1)
}
console.log((patchRun.stdout || '').trim())

/* Never ship runtime state: credentials, sessions, logs. */
function wipeRuntimeState(root) {
  const homeDir = join(root, 'runtime', 'home')
  for (const name of ['.credentials.yaml', 'settings.yaml', '.anonymous-user-id']) {
    const target = join(homeDir, name)
    if (existsSync(target)) rmSync(target, { force: true })
  }
  for (const dir of ['storages', 'logs']) {
    const target = join(homeDir, dir)
    if (existsSync(target)) rmSync(target, { recursive: true, force: true })
  }
}

/* Ship an empty key template, never a filled one. */
function writeKeyTemplate(root) {
  const target = join(root, 'apikey.txt')
  if (existsSync(target)) return
  writeFileSync(
    target,
    [
      '# dsh-pure · API Key（明文，自己填，别外借 U 盘）',
      '#',
      '#   DEEPSEEK_API_KEY=sk-你的key',
      '# 或者单独一行 sk-你的key',
      '',
      'DEEPSEEK_API_KEY=',
    ].join('\r\n'),
    'utf8',
  )
}

wipeRuntimeState(out)
writeKeyTemplate(out)

console.log('[pure] done')
