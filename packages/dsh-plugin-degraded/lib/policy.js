/**
 * Probe → degradation decision — pure.
 *
 * Three-state switches (`auto` | `on` | `off`) merge with the CLI/environment
 * override. Nothing here touches the filesystem or Cordis, so every branch is
 * unit-testable.
 */

/** Bump when the policy shape changes. */
export const POLICY_VERSION = 1

/** Accepted tri-state values. */
export const TRI_STATES = Object.freeze(['auto', 'on', 'off'])

/** Accepted UI presets. */
export const UI_PRESETS = Object.freeze(['minimal', 'full'])

/**
 * Decorations a `minimal` preset must not mount. The client half reads this as
 * feature flags; the profile patch disables the third-party rows that own them.
 */
export const DECORATION_FEATURES = Object.freeze([
  'skin',
  'wallpaper',
  'stage',
  'canvas',
  'particles',
  'rain',
  'aurora',
  'motion',
  'image-preview',
  'widget',
])

/**
 * Tools that belong to each capability. A name may not exist in a given profile:
 * the caller intersects this list with the tools that are actually visible
 * before calling `ctx.tools.restrict`, because `restrict` rejects unknown names.
 */
export const TOOLS_BY_CAPABILITY = Object.freeze({
  shell: Object.freeze(['bash', 'pwsh', 'bash_persistent', 'pwsh_persistent']),
  terminal: Object.freeze([
    'terminal_open',
    'terminal_read',
    'terminal_write',
    'terminal_close',
    'terminal_list',
    'terminal_signal',
    'terminal_rename',
  ]),
  image: Object.freeze(['read_image']),
  // The UI capability owns no tool: it disables decoration rows and drives the
  // client feature flags (`disabledFeatures`), so nothing is denied here.
  ui: Object.freeze([]),
})

const asObject = (value) => (value && typeof value === 'object' ? value : {})

/** Normalize a tri-state config value. */
export function normalizeTri(value, fallback = 'auto') {
  const normalized = typeof value === 'string' ? value.trim().toLowerCase() : ''
  return TRI_STATES.includes(normalized) ? normalized : fallback
}

/**
 * Normalize the `ui` switch, which accepts both tri-states and preset names.
 * `on` → `full`, `off` → `minimal`, anything else → `auto`.
 */
export function normalizeUiSwitch(value, fallback = 'auto') {
  const normalized = typeof value === 'string' ? value.trim().toLowerCase() : ''
  if (normalized === 'full' || normalized === 'on') return 'full'
  if (normalized === 'minimal' || normalized === 'off') return 'minimal'
  return fallback
}

/**
 * Merge one tri-state with the probed fact.
 *
 * @returns {{ enabled: boolean, reason: string }}
 */
export function resolveTri(configured, detected, onReason, offReason) {
  const state = normalizeTri(configured)
  const probeReason = detected === true ? onReason : offReason
  if (state === 'on') return { enabled: true, reason: `config 强制开启（探测结论：${probeReason}）` }
  if (state === 'off') return { enabled: false, reason: `config 强制关闭（探测结论：${probeReason}）` }
  return { enabled: detected === true, reason: probeReason }
}

/**
 * Decide what to degrade.
 *
 * @param {object} capabilities  output of `probeCapabilities`
 * @param {object} [config]      plugin row config (shell/ui/terminal/image/report)
 * @param {{ uiPreset?: string }} [overrides]  CLI / environment override, highest priority
 */
export function decide(capabilities = {}, config = {}, overrides = {}) {
  const caps = asObject(capabilities)
  const cfg = asObject(config)
  const shellCaps = asObject(caps.shell)
  const terminalCaps = asObject(caps.terminal)
  const uiCaps = asObject(caps.ui)
  const imageCaps = asObject(caps.image)
  const notes = []

  // ── shell ───────────────────────────────────────────────────────────────
  const shellMode = typeof shellCaps.mode === 'string' ? shellCaps.mode : 'none'
  const shell = resolveTri(
    cfg.shell,
    shellMode !== 'none',
    shellMode === 'pwsh'
      ? 'PowerShell 7 可用'
      : shellMode === 'powershell'
        ? '回退到 Windows PowerShell 5.1'
        : shellMode === 'cmd'
          ? '回退到 cmd.exe'
          : '未找到 shell',
    shellMode === 'none' ? '没有可用的 shell' : '探测判定不可用',
  )

  // ── terminal ────────────────────────────────────────────────────────────
  // Availability follows the terminal SERVICE, not the Host-side backend list:
  // a session preset registers its PTY backend inside an isolated realm, so the
  // Host view can be empty — or the service invisible — while tools still work.
  // `available: null` means "unknown", and an unknown capability is NOT degraded.
  const backends = Array.isArray(terminalCaps.backends) ? terminalCaps.backends : []
  const terminalAvailable =
    terminalCaps.available === null ? true : terminalCaps.available === true ? true : backends.length > 0
  const terminalFallbackReason = terminalAvailable
    ? `PTY 后端可用（${backends.join(', ') || '由 preset 提供'}）`
    : '终端服务未注册，常驻终端不可用'
  const terminal = resolveTri(
    cfg.terminal,
    terminalAvailable,
    typeof terminalCaps.reason === 'string' && terminalCaps.reason.length > 0
      ? terminalCaps.reason
      : terminalFallbackReason,
    typeof terminalCaps.reason === 'string' && terminalCaps.reason.length > 0
      ? terminalCaps.reason
      : '终端服务未注册，常驻终端不可用',
  )

  // ── image ───────────────────────────────────────────────────────────────
  const image = resolveTri(
    cfg.image,
    imageCaps.preview === true,
    imageCaps.reason === undefined ? '图片预览可用' : String(imageCaps.reason),
    imageCaps.reason === undefined ? '图片预览不可用' : String(imageCaps.reason),
  )

  // ── ui preset ───────────────────────────────────────────────────────────
  const overridePreset = overrides && typeof overrides === 'object' ? overrides.uiPreset : undefined
  const configSwitch = normalizeUiSwitch(cfg.ui, 'auto')
  const probedPreset = uiCaps.decorationAllowed === false ? 'minimal' : 'full'

  let uiPreset
  let uiReason
  if (UI_PRESETS.includes(String(overridePreset))) {
    uiPreset = String(overridePreset)
    uiReason = '命令行 / 环境变量覆盖'
  } else if (configSwitch !== 'auto') {
    uiPreset = configSwitch
    uiReason = 'config 指定'
  } else {
    uiPreset = probedPreset
    uiReason = uiCaps.reason === undefined ? '探测结论' : String(uiCaps.reason)
  }

  const ui = { enabled: uiPreset === 'full', reason: uiReason }

  // ── derive ──────────────────────────────────────────────────────────────
  const effective = {
    shell: shell.enabled,
    terminal: terminal.enabled,
    ui: ui.enabled,
    image: image.enabled,
  }

  const reasons = {
    shell: shell.reason,
    terminal: terminal.reason,
    ui: ui.reason,
    image: image.reason,
  }

  const disabledTools = []
  for (const [capability, enabled] of Object.entries(effective)) {
    if (enabled) continue
    for (const name of TOOLS_BY_CAPABILITY[capability] || []) {
      if (!disabledTools.includes(name)) disabledTools.push(name)
    }
  }

  const disabledFeatures = uiPreset === 'minimal' ? [...DECORATION_FEATURES] : []

  if (caps.env && caps.env.isPE === true) notes.push('检测到 WinPE：默认走 minimal，桌面端不参与')
  if (caps.env && caps.env.dshHomeWritable === false) notes.push('DSH_HOME 不可写：会话与存储可能失败')

  return {
    policyVersion: POLICY_VERSION,
    uiPreset,
    effective,
    disabledTools,
    disabledFeatures,
    reasons,
    notes,
  }
}

/**
 * Intersect a policy's disabled-tool list with the tool names a scope can
 * actually see. `ctx.tools.restrict` rejects unknown names, so this must run
 * before the restriction is registered.
 *
 * @param {string[]} disabledTools
 * @param {string[]} visibleTools
 */
export function intersectTools(disabledTools, visibleTools) {
  const visible = new Set(Array.isArray(visibleTools) ? visibleTools : [])
  return (Array.isArray(disabledTools) ? disabledTools : []).filter((name) => visible.has(name))
}
