/**
 * Capability probe for dsh-rescue — pure.
 *
 * Every filesystem / environment fact arrives through `deps`, so this module is
 * unit-testable without touching a real machine. Field naming is shared with the
 * A-side launcher probe: `capabilities.{shell,terminal,ui,image}` + `ui.preset`.
 */

/** Bump when the shape of the returned object changes. */
export const PROBE_VERSION = 1

/** Image media types the DSH attachment layer accepts. */
export const MEDIA_TYPES = Object.freeze(['image/png', 'image/jpeg', 'image/webp', 'image/gif'])

const empty = ''
const str = (value) => (typeof value === 'string' ? value : empty)
const truthy = (value) => str(value).length > 0
const asList = (value) => (Array.isArray(value) ? value.filter((item) => typeof item === 'string') : [])

/**
 * @typedef {object} ProbeDeps
 * @property {string} [platform]                 process.platform
 * @property {Record<string, string | undefined>} [env]
 * @property {(path: string) => boolean} [pathExists]   file or symlink exists
 * @property {(dir: string) => boolean} [dirExists]
 * @property {(dir: string) => boolean} [canWrite]      write probe against a directory
 * @property {() => string[]} [terminalBackends]        live PTY backend names
 * @property {() => boolean} [hasTerminalService]       whether `ctx.terminals` exists
 * @property {string[]} [argv]                          app argv, for --ui style flags
 */

/** Fill a deps object with safe defaults so a partial test double still works. */
function normalizeDeps(deps = {}) {
  return {
    platform: str(deps.platform) || process.platform,
    env: deps.env && typeof deps.env === 'object' ? deps.env : process.env,
    pathExists: typeof deps.pathExists === 'function' ? deps.pathExists : () => false,
    dirExists: typeof deps.dirExists === 'function' ? deps.dirExists : () => false,
    canWrite: typeof deps.canWrite === 'function' ? deps.canWrite : () => false,
    terminalBackends: typeof deps.terminalBackends === 'function' ? deps.terminalBackends : () => [],
    hasTerminalService: typeof deps.hasTerminalService === 'function' ? deps.hasTerminalService : undefined,
    argv: asList(deps.argv),
  }
}

/** Split a PATH-like string using the platform separator. */
function pathEntries(env, platform) {
  const raw = str(env.PATH) || str(env.Path)
  const separator = platform === 'win32' ? ';' : ':'
  return raw
    .split(separator)
    .map((entry) => entry.trim().replace(/^"|"$/gu, ''))
    .filter((entry) => entry.length > 0)
}

/** Join without importing node:path so the module stays dependency-free. */
function joinPath(base, name, platform) {
  const separator = platform === 'win32' ? '\\' : '/'
  return base.endsWith('\\') || base.endsWith('/') ? `${base}${name}` : `${base}${separator}${name}`
}

/**
 * Detect PowerShell / cmd executables in resolution order, mirroring what
 * `@deepseek-ai/dsh-pwsh-local` itself would spawn.
 *
 * @returns {{ mode: 'pwsh'|'powershell'|'cmd'|'none', executable: string, tried: string[], reason: string }}
 */
export function detectShell(deps) {
  const d = normalizeDeps(deps)
  const env = d.env
  const isWindows = d.platform === 'win32'
  const tried = []

  if (!isWindows) {
    const sh = '/bin/sh'
    const exists = d.pathExists(sh)
    tried.push(sh)
    return {
      mode: exists ? 'cmd' : 'none',
      executable: exists ? sh : empty,
      tried,
      reason: exists ? 'POSIX shell (/bin/sh) 可用' : '未找到 /bin/sh',
    }
  }

  const systemRoot = str(env.SystemRoot) || 'C:\\Windows'
  const programFiles = str(env.ProgramFiles) || 'C:\\Program Files'

  const pwshCandidates = [joinPath(programFiles, 'PowerShell\\7\\pwsh.exe', d.platform)]
  for (const entry of pathEntries(env, d.platform)) {
    pwshCandidates.push(joinPath(entry, 'pwsh.exe', d.platform))
  }
  for (const candidate of pwshCandidates) {
    tried.push(candidate)
    if (d.pathExists(candidate)) {
      return { mode: 'pwsh', executable: candidate, tried, reason: 'PowerShell 7 (pwsh) 可用' }
    }
  }

  const legacy = joinPath(systemRoot, 'System32\\WindowsPowerShell\\v1.0\\powershell.exe', d.platform)
  tried.push(legacy)
  if (d.pathExists(legacy)) {
    return {
      mode: 'powershell',
      executable: legacy,
      tried,
      reason: '仅有 Windows PowerShell 5.1（pwsh 7 缺失），语法与 UTF-8 输出受限',
    }
  }

  const cmd = joinPath(systemRoot, 'System32\\cmd.exe', d.platform)
  tried.push(cmd)
  if (d.pathExists(cmd)) {
    return {
      mode: 'cmd',
      executable: cmd,
      tried,
      reason: 'pwsh 与 powershell.exe 均缺失，只能用 cmd.exe',
    }
  }

  return { mode: 'none', executable: empty, tried, reason: '找不到任何 shell 可执行文件' }
}

/**
 * Full capability probe.
 *
 * @param {ProbeDeps} [deps]
 * @returns {{
 *   probeVersion: number,
 *   shell: { mode: string, executable: string, name: string, tried: string[], reason: string },
 *   terminal: { available: boolean, conpty: boolean, backends: string[], reason: string },
 *   ui: { presetSource: 'probe', gpu: boolean, decorationAllowed: boolean, reason: string },
 *   image: { preview: boolean, mediaTypes: readonly string[], reason: string },
 *   env: { isPE: boolean, dshHome: string, dshHomeWritable: boolean, platform: string, arch: string, node: string, reasons: string[] }
 * }}
 */
export function probeCapabilities(deps = {}) {
  const d = normalizeDeps(deps)
  const env = d.env
  const isWindows = d.platform === 'win32'

  // ── shell ────────────────────────────────────────────────────────────────
  const shell = detectShell(d)
  const shellName = shell.executable ? shell.executable.split(/[\\/]/u).pop() : empty

  // ── terminal (ConPTY) ───────────────────────────────────────────────────
  // The PTY backend is registered by a session preset inside its own realm
  // (`isolate: { terminals: true }`), so the Host-side `listBackends()` may be
  // empty — or the whole service may be invisible — even while terminal tools
  // work. `available: null` means "the Host cannot tell", and the policy then
  // deliberately does not degrade.
  const backends = asList(d.terminalBackends())
  let available
  let terminalReason

  if (typeof d.hasTerminalService === 'function') {
    if (d.hasTerminalService() === true) {
      available = true
      terminalReason =
        backends.length > 0 ? `PTY 后端可用：${backends.join(', ')}` : '终端服务已注册（PTY 后端由会话 preset 提供）'
    } else {
      available = null
      terminalReason = 'Host 层看不到终端服务（可能由会话 preset 在隔离域提供）；默认不降级'
    }
  } else {
    available = backends.length > 0
    terminalReason =
      backends.length > 0 ? `PTY 后端可用：${backends.join(', ')}` : '没有注册任何 PTY 后端，常驻终端不可用'
  }

  const conpty = backends.some((name) => /conpty|pty/iu.test(name))

  // ── environment / PE ────────────────────────────────────────────────────
  const reasonList = []
  const systemRoot = str(env.SystemRoot)
  const systemDrive = str(env.SystemDrive)

  if (truthy(env.MiniNT)) reasonList.push('MiniNT 键值存在')
  if (truthy(env.WINPE) || truthy(env.WinPE)) reasonList.push('WINPE 变量存在')
  if (/^X:/iu.test(systemRoot)) reasonList.push('SystemRoot 在 X:')
  if (/^X:$/iu.test(systemDrive)) reasonList.push('SystemDrive 是 X:')
  const isPE = reasonList.length > 0

  const dshHome = str(env.DSH_HOME)
  const dshHomeWritable = dshHome.length > 0 ? d.canWrite(dshHome) : false
  if (dshHome.length === 0) reasonList.push('DSH_HOME 未设置')
  else if (!dshHomeWritable) reasonList.push('DSH_HOME 不可写')

  // ── ui / gpu ────────────────────────────────────────────────────────────
  const forceNoGpu = str(env.DSH_RESCUE_GPU).toLowerCase() === '0'
  const gpu = isWindows ? !isPE && !forceNoGpu : !forceNoGpu
  const decorationAllowed = !isPE && !forceNoGpu
  const uiReason = isPE
    ? 'WinPE 环境：默认关闭全部装饰层'
    : forceNoGpu
      ? 'DSH_RESCUE_GPU=0：关闭 GPU 相关装饰'
      : '桌面环境：允许装饰层（仍需 ui.preset 决定是否启用）'

  // ── image preview ───────────────────────────────────────────────────────
  const preview = !isPE && gpu
  const imageReason = preview ? '图片预览可用' : isPE ? 'WinPE：无预览渲染管线' : 'GPU 不可用：关闭图片预览'

  return {
    probeVersion: PROBE_VERSION,
    shell: {
      mode: shell.mode,
      executable: shell.executable,
      name: shellName,
      tried: shell.tried,
      reason: shell.reason,
    },
    terminal: { available, conpty, backends, reason: terminalReason },
    ui: {
      presetSource: 'probe',
      gpu,
      decorationAllowed,
      reason: uiReason,
    },
    image: {
      preview,
      mediaTypes: [...MEDIA_TYPES],
      reason: imageReason,
    },
    env: {
      isPE,
      dshHome,
      dshHomeWritable,
      platform: d.platform,
      arch: str(env.PROCESSOR_ARCHITECTURE) || str(env.PROCESSOR_ARCH),
      node: str(env.DSH_RESCUE_NODE_VERSION) || `v${process.versions.node}`,
      reasons: reasonList,
    },
  }
}
