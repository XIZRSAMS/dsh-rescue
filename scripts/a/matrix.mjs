#!/usr/bin/env node
/**
 * P5 · degradation matrix.
 *
 * a-normal       expected to answer 200
 * b-no-pwsh      PATH without PowerShell dirs + empty ProgramFiles (detectShell
 *                probes ProgramFiles\PowerShell\7 first, so PATH alone is a no-op)
 * b2-shell-none  PATH empty + SystemRoot/ProgramFiles redirected: forces shell=none
 * c-readonly     DSH_HOME made read-only with icacls; degrade or controlled
 *                refusal both pass, a hang never does
 */

import { mkdirSync, rmSync, symlinkSync } from 'node:fs'
import { join } from 'node:path'

import { REPO_ROOT, RUNTIME_DIR, exists, parseArgs, readJson, resolveLayers, table } from '../_shared.mjs'
import { probeThisMachine } from '../_probe.mjs'
import { probeCapabilities } from '../../packages/dsh-plugin-degraded/lib/probe.js'
import { decide } from '../../packages/dsh-plugin-degraded/lib/policy.js'
import { LOG_DIR, nowIso, runCapture, writeLogJson } from './lib/util.mjs'
import { caseOk } from './lib/judge.mjs'
import { runBoot } from './boot.mjs'

function emptyDir(name) {
  const dir = join(LOG_DIR, 'matrix', name)
  rmSync(dir, { recursive: true, force: true })
  mkdirSync(dir, { recursive: true })
  return dir
}

function degradeList(summary) {
  if (!summary || !summary.effective) return []
  return Object.entries(summary.effective)
    .filter(([, enabled]) => enabled === false)
    .map(([name]) => name)
}

/** Run the same probe the plugin uses, pointed at one specific home. */
function homeWritable(home) {
  const previous = process.env.DSH_HOME
  process.env.DSH_HOME = home
  try {
    const caps = probeThisMachine({ dshRoot: join(RUNTIME_DIR, 'node_modules') })
    return caps.env.dshHomeWritable === true
  } finally {
    if (previous === undefined) delete process.env.DSH_HOME
    else process.env.DSH_HOME = previous
  }
}

function record(name, result, detail) {
  return {
    at: nowIso(),
    case: name,
    kind: result.kind,
    ok: caseOk(result.kind),
    degrade: degradeList(result.capsSummary),
    detail,
    status: result.status,
    readyMs: result.readyMs,
    exitCode: result.exitCode,
    shellMode: result.capsSummary ? result.capsSummary.shellMode : '',
    logs: result.logs,
    stderrTail: result.stderrTail,
  }
}

async function main() {
  const args = parseArgs()
  if (args.help === true) {
    console.log('usage: node scripts/a/matrix.mjs [--timeout <seconds>] [--home <dir>] [--json]')
    process.exit(0)
  }

  const fileConfig = readJson(join(REPO_ROOT, 'config.json'), null) || {}
  const layers = resolveLayers({ cli: args, file: fileConfig, env: process.env })
  const base = {
    home: layers.home,
    profile: layers.profile.name,
    ui: layers.profile.ui === 'auto' ? 'minimal' : layers.profile.ui,
    timeoutMs: Number(args.timeout || 15) * 1000,
  }

  const results = []

  /* ── a · normal ─────────────────────────────────────────────────────────── */
  const normal = await runBoot({ ...base, label: 'matrix-normal' })
  results.push(record('a-normal', normal, '正常环境：应拿到 200'))

  /* ── b · no PowerShell on PATH ──────────────────────────────────────────── */
  const fakeProgramFiles = emptyDir('fake-program-files')
  const rawPath = String(process.env.PATH || process.env.Path || '')
  const filteredPath = rawPath
    .split(';')
    .filter((segment) => segment.length > 0 && !/powershell|pwsh/iu.test(segment))
    .join(';')
  const noPwsh = await runBoot({
    ...base,
    label: 'matrix-no-pwsh',
    env: { PATH: filteredPath, ProgramFiles: fakeProgramFiles },
  })
  results.push(
    record(
      'b-no-pwsh',
      noPwsh,
      'PATH 去掉 PowerShell 目录 + ProgramFiles 指向空目录；本机 PowerShell 5.1 位于 System32，无法用环境变量隐藏，所以这里只验证「找不到 pwsh 7 时仍能起服务」；真正的 shell=none 由 b2 探针覆盖',
    ),
  )

  /* ── b2 · shell=none decision (probe-level) ─────────────────────────────── */
  /* A real boot under a fake SystemRoot is impossible: node.exe aborts in its
   * CSPRNG initialization (measured: exit 134, "Assertion failed:
   * ncrypto::CSPRNG"). Verify the degradation branch with the same pure
   * probe/policy pair the plugin uses, and say so in the record. */
  const noShellCaps = probeCapabilities({
    platform: 'win32',
    env: { SystemRoot: 'X:\\nowhere', ProgramFiles: 'X:\\nowhere', PATH: '' },
    pathExists: () => false,
    dirExists: () => false,
    canWrite: () => false,
    terminalBackends: () => [],
  })
  const noShellPolicy = decide(noShellCaps, {})
  const noShellDisabled = Array.isArray(noShellPolicy.disabledTools) ? noShellPolicy.disabledTools : []
  results.push({
    at: nowIso(),
    case: 'b2-shell-none',
    kind: 'probe-only',
    ok:
      noShellCaps.shell.mode === 'none' &&
      noShellPolicy.effective.shell === false &&
      noShellDisabled.includes('bash') &&
      noShellDisabled.includes('pwsh'),
    degrade: noShellPolicy.effective.shell === false ? ['shell'] : [],
    detail:
      '注入式探针（pathExists 全空）验证 shell=none 的降级决策：bash/pwsh 应被隐藏。' +
      '真机启动无法模拟：覆盖 SystemRoot 会让 Node 在 CSPRNG 初始化时 abort（实测 exit 134）',
    status: 0,
    readyMs: null,
    exitCode: null,
    shellMode: noShellCaps.shell.mode,
    disabledTools: noShellDisabled,
    logs: null,
    stderrTail: '',
  })

  /* ── c · read-only DSH_HOME ─────────────────────────────────────────────── */
  const caseHome = join(LOG_DIR, 'matrix', 'readonly-home')
  rmSync(caseHome, { recursive: true, force: true })
  mkdirSync(caseHome, { recursive: true })
  let junctionMade = false
  const systemRoot = process.env.SystemRoot || 'C:\\Windows'
  const icacls = join(systemRoot, 'System32', 'icacls.exe')
  const user = String(process.env.USERNAME || '')
  let readonlyRecord

  try {
    symlinkSync(join(base.home, 'profiles'), join(caseHome, 'profiles'), 'junction')
    junctionMade = true
  } catch (error) {
    readonlyRecord = {
      at: nowIso(),
      case: 'c-readonly-home',
      kind: 'skipped',
      ok: false,
      degrade: [],
      detail: '无法创建 profile junction：' + String((error && error.message) || error),
      status: 0,
      readyMs: null,
      exitCode: null,
      shellMode: '',
      logs: null,
      stderrTail: '',
    }
  }

  if (!readonlyRecord) {
    const deny = await runCapture(icacls, [caseHome, '/deny', user + ':(OI)(CI)(W)'], { timeoutMs: 30000 })
    if (deny.code !== 0 || !user) {
      readonlyRecord = {
        at: nowIso(),
        case: 'c-readonly-home',
        kind: 'skipped',
        ok: false,
        degrade: [],
        detail: 'icacls deny 失败（可能权限不足）：' + String(deny.stderr || deny.stdout || deny.error || '').trim().slice(-400),
        status: 0,
        readyMs: null,
        exitCode: null,
        shellMode: '',
        logs: null,
        stderrTail: '',
      }
    } else {
      const writable = homeWritable(caseHome)
      const blocked = await runBoot({ ...base, label: 'matrix-readonly', home: caseHome })
      readonlyRecord = record(
        'c-readonly-home',
        blocked,
        'DSH_HOME 只读：dshHomeWritable=' + String(writable) + '；degrade 与受控失败都算通过，挂起算失败',
      )
      if (writable !== false) {
        readonlyRecord.ok = false
        readonlyRecord.detail += '（探针没有报告只读，ACL 可能未生效）'
      }
      readonlyRecord.probeHomeWritable = writable
    }
    await runCapture(icacls, [caseHome, '/remove:d', user], { timeoutMs: 30000 })
  }
  results.push(readonlyRecord)
  if (junctionMade) {
    try {
      rmSync(caseHome, { recursive: true, force: true })
    } catch {
      /* the ACL removal above should have made this possible */
    }
  }

  const out = writeLogJson('matrix.json', results)
  if (args.json === true) console.log(JSON.stringify(results, null, 2))
  else {
    console.log('[dsh-rescue] matrix.json → ' + out)
    console.log(
      table(
        results.map((item) => [
          item.case,
          (item.ok ? 'ok' : 'FAIL') + ' · kind=' + item.kind + (item.readyMs === null ? '' : ' · ' + String(item.readyMs) + 'ms'),
        ]),
      ),
    )
    for (const item of results) {
      if (!item.ok) console.error('  ' + item.case + ': ' + item.detail)
    }
  }

  if (results.some((item) => !item.ok)) process.exit(1)
}

await main()
