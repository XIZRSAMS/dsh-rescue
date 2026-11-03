/**
 * Plugin config normalization — pure.
 *
 * The plugin declares no `Config` schema on purpose: rescue targets machines
 * without a writable package store (WinPE), so it must run with zero runtime
 * dependencies instead of importing `@deepseek-ai/schemastery`. This module is
 * the hand-written equivalent: defaults, enum checks, and a warning list.
 */

import { normalizeTri, normalizeUiSwitch } from './policy.js'

const isObject = (value) => value !== null && typeof value === 'object' && !Array.isArray(value)
const asBool = (value, fallback) => (typeof value === 'boolean' ? value : fallback)

/**
 * @param {unknown} raw  the row's `config` object
 * @returns {{
 *   shell: string, ui: string, terminal: string, image: string,
 *   report: { promptSection: boolean, command: boolean },
 *   server: { allowRemote: boolean },
 *   client: { statusBar: boolean },
 *   warnings: string[]
 * }}
 */
export function normalizeConfig(raw = {}) {
  const source = isObject(raw) ? raw : {}
  const warnings = []

  const pickTri = (key) => {
    const value = source[key]
    if (value === undefined) return 'auto'
    const normalized = normalizeTri(value, 'invalid')
    if (normalized === 'invalid') {
      warnings.push(`config.${key}=${JSON.stringify(value)} 不是 auto/on/off，按 auto 处理`)
      return 'auto'
    }
    return normalized
  }

  const uiRaw = source.ui
  const uiValue = uiRaw === undefined ? 'auto' : normalizeUiSwitch(uiRaw, 'invalid')
  if (uiValue === 'invalid') warnings.push(`config.ui=${JSON.stringify(uiRaw)} 不是 auto/minimal/full，按 auto 处理`)

  const report = isObject(source.report) ? source.report : {}
  const server = isObject(source.server) ? source.server : {}
  const client = isObject(source.client) ? source.client : {}

  return {
    shell: pickTri('shell'),
    ui: uiValue === 'invalid' ? 'auto' : uiValue,
    terminal: pickTri('terminal'),
    image: pickTri('image'),
    report: {
      promptSection: asBool(report.promptSection, true),
      command: asBool(report.command, true),
    },
    server: {
      allowRemote: asBool(server.allowRemote, false),
    },
    client: {
      statusBar: asBool(client.statusBar, true),
    },
    warnings,
  }
}
