/**
 * Environment report rendering — pure and redacted.
 *
 * The report never contains an absolute path, a user name, or a credential: it
 * is shown to the model, written into the session log, and served to the
 * browser, so it must be safe in all three places.
 */

/** Bump when the rendered shape changes. */
export const REPORT_VERSION = 1

const asObject = (value) => (value && typeof value === 'object' ? value : {})

const LABELS = Object.freeze({
  shell: 'Shell',
  terminal: '终端',
  image: '图片预览',
  ui: 'UI 装饰',
})

const STATE = Object.freeze({ true: '已启用', false: '已关闭' })

/** Short, path-free description of one capability. */
function describeCapability(name, capabilities, policy) {
  const caps = asObject(capabilities)
  const effective = asObject(asObject(policy).effective)
  const reasons = asObject(asObject(policy).reasons)
  const state = effective[name] === true

  if (name === 'shell') {
    const mode = String(asObject(caps.shell).mode || 'none')
    const binary = String(asObject(caps.shell).name || '')
    return `${STATE[state]}（${mode}${binary ? ` · ${binary}` : ''}）— ${reasons.shell || ''}`
  }
  if (name === 'terminal') {
    const backends = Array.isArray(asObject(caps.terminal).backends) ? asObject(caps.terminal).backends : []
    return `${STATE[state]}（${backends.length} 个 PTY 后端）— ${reasons.terminal || ''}`
  }
  if (name === 'image') {
    return `${STATE[state]} — ${reasons.image || ''}`
  }
  return `${STATE[state]}（preset: ${String(asObject(policy).uiPreset || 'minimal')}）— ${reasons.ui || ''}`
}

/**
 * Build the redacted JSON payload (the browser route's body).
 *
 * @param {{ capabilities?: object, policy?: object, meta?: object }} input
 */
export function renderJson(input = {}) {
  const capabilities = asObject(asObject(input).capabilities)
  const policy = asObject(asObject(input).policy)
  const meta = asObject(asObject(input).meta)

  return {
    reportVersion: REPORT_VERSION,
    generatedAt: typeof meta.generatedAt === 'number' ? meta.generatedAt : Date.now(),
    rescueVersion: String(meta.rescueVersion || ''),
    profile: String(meta.profile || ''),
    capabilities: {
      shell: {
        mode: String(asObject(capabilities.shell).mode || 'none'),
        name: String(asObject(capabilities.shell).name || ''),
        reason: String(asObject(capabilities.shell).reason || ''),
      },
      terminal: {
        available:
          asObject(capabilities.terminal).available === null
            ? null
            : asObject(capabilities.terminal).available === true,
        conpty: asObject(capabilities.terminal).conpty === true,
        backends: Array.isArray(asObject(capabilities.terminal).backends)
          ? asObject(capabilities.terminal).backends.map(String)
          : [],
        reason: String(asObject(capabilities.terminal).reason || ''),
      },
      ui: {
        gpu: asObject(capabilities.ui).gpu === true,
        decorationAllowed: asObject(capabilities.ui).decorationAllowed === true,
        reason: String(asObject(capabilities.ui).reason || ''),
      },
      image: {
        preview: asObject(capabilities.image).preview === true,
        mediaTypes: Array.isArray(asObject(capabilities.image).mediaTypes)
          ? asObject(capabilities.image).mediaTypes.map(String)
          : [],
        reason: String(asObject(capabilities.image).reason || ''),
      },
      env: {
        isPE: asObject(capabilities.env).isPE === true,
        dshHomeWritable: asObject(capabilities.env).dshHomeWritable === true,
        platform: String(asObject(capabilities.env).platform || ''),
        arch: String(asObject(capabilities.env).arch || ''),
        node: String(asObject(capabilities.env).node || ''),
        reasons: Array.isArray(asObject(capabilities.env).reasons)
          ? asObject(capabilities.env).reasons.map(String)
          : [],
      },
    },
    policy: {
      uiPreset: String(policy.uiPreset || 'minimal'),
      effective: {
        shell: asObject(policy.effective).shell === true,
        terminal: asObject(policy.effective).terminal === true,
        ui: asObject(policy.effective).ui === true,
        image: asObject(policy.effective).image === true,
      },
      disabledTools: Array.isArray(policy.disabledTools) ? policy.disabledTools.map(String) : [],
      disabledFeatures: Array.isArray(policy.disabledFeatures) ? policy.disabledFeatures.map(String) : [],
      reasons: {
        shell: String(asObject(policy.reasons).shell || ''),
        terminal: String(asObject(policy.reasons).terminal || ''),
        ui: String(asObject(policy.reasons).ui || ''),
        image: String(asObject(policy.reasons).image || ''),
      },
      notes: Array.isArray(policy.notes) ? policy.notes.map(String) : [],
    },
  }
}

/**
 * Render the human-readable report used by `/rescue` and the prompt section.
 *
 * @param {{ capabilities?: object, policy?: object, meta?: object }} input
 * @returns {{ text: string, json: object }}
 */
export function renderReport(input = {}) {
  const json = renderJson(input)
  const caps = asObject(input.capabilities)
  const policy = asObject(input.policy)
  const envInfo = asObject(caps.env)

  const lines = []
  lines.push('环境报告 · dsh-rescue')
  lines.push(
    `平台 ${json.capabilities.env.platform || '未知'} (${json.capabilities.env.arch || '未知'}) · Node ${json.capabilities.env.node || '未知'}`,
  )
  lines.push(`WinPE: ${json.capabilities.env.isPE ? '是' : '否'} · DSH_HOME: ${json.capabilities.env.dshHomeWritable ? '可写' : '不可写'}`)
  lines.push('')

  for (const name of ['shell', 'terminal', 'image', 'ui']) {
    lines.push(`${LABELS[name]}: ${describeCapability(name, caps, policy)}`)
  }

  const disabled = Object.entries(json.policy.effective)
    .filter(([, enabled]) => enabled === false)
    .map(([name]) => name)

  lines.push('')
  lines.push(disabled.length > 0 ? `已关闭能力: ${disabled.map((name) => LABELS[name]).join('、')}` : '已关闭能力: 无')

  if (json.policy.disabledTools.length > 0) {
    lines.push(`被禁用工具: ${json.policy.disabledTools.join(', ')}`)
  }

  if (envInfo.reasons && envInfo.reasons.length > 0) {
    lines.push(`环境提示: ${envInfo.reasons.join('；')}`)
  }

  if (json.policy.notes.length > 0) {
    lines.push('')
    lines.push('注意:')
    for (const note of json.policy.notes) lines.push(`- ${note}`)
  }

  lines.push('')
  lines.push(`UI 预设: ${json.policy.uiPreset} · 切换: start.cmd --ui full | node scripts/setup.mjs --ui full`)

  return { text: lines.join('\n'), json }
}
