/**
 * Pure acceptance logic for the A-side programs.
 *
 * Nothing here touches the filesystem: probe validation and matrix
 * classification are unit-tested and reused by the runner and the summary.
 */

/** Keys the P1 record must always carry (task contract). */
export const PROBE_KEYS = Object.freeze(['shell', 'terminal', 'ui', 'image', 'env'])

/** Result kinds produced by a boot attempt. */
export const RUN_KINDS = Object.freeze(['degrade', 'fail-fast', 'hang', 'crash'])

/**
 * @param {unknown} record
 * @returns {{ ok: boolean, missing: string[] }}
 */
export function validateProbeRecord(record) {
  const value = record && typeof record === 'object' ? record : {}
  const missing = PROBE_KEYS.filter((key) => {
    const entry = value[key]
    return entry === null || entry === undefined || typeof entry !== 'object'
  })
  return { ok: missing.length === 0, missing }
}

/**
 * Classify one service start attempt.
 *
 * - degrade:   the loopback route answered 200 (the process came up).
 * - fail-fast: the process exited non-zero and left a diagnostic — a controlled
 *              refusal (e.g. an unwritable DSH_HOME), not a crash.
 * - hang:      no response before the deadline while the process was still alive.
 * - crash:     a clean or silent exit without a response.
 *
 * @param {{ responded?: boolean, exitCode?: number | null, timedOut?: boolean, tail?: string }} input
 * @returns {'degrade' | 'fail-fast' | 'hang' | 'crash'}
 */
export function classifyRun(input = {}) {
  if (input.responded === true) return 'degrade'

  const exitCode = typeof input.exitCode === 'number' ? input.exitCode : null
  const tail = String(input.tail || '').trim()

  if (input.timedOut === true || exitCode === null) return 'hang'
  if (exitCode === 0) return 'crash'
  return tail.length > 0 ? 'fail-fast' : 'crash'
}

/**
 * A case passes when it degraded or refused in a controlled way. The task text
 * asks for "degrade and continue", but a read-only DSH_HOME is refused by the
 * kernel before any route exists; counting that as failure would be dishonest.
 *
 * @param {string} kind
 * @param {string[]} [allowed]
 */
export function caseOk(kind, allowed = ['degrade', 'fail-fast']) {
  return allowed.includes(kind)
}

/** Compact, token-free summary of a capabilities payload. */
export function summarizeCapabilities(payload) {
  const body = payload && typeof payload === 'object' ? payload : {}
  const capabilities = body.capabilities && typeof body.capabilities === 'object' ? body.capabilities : {}
  const policy = body.policy && typeof body.policy === 'object' ? body.policy : {}
  const terminal = capabilities.terminal && typeof capabilities.terminal === 'object' ? capabilities.terminal : {}
  const env = capabilities.env && typeof capabilities.env === 'object' ? capabilities.env : {}
  const effective = policy.effective && typeof policy.effective === 'object' ? policy.effective : {}

  return {
    shellMode: String((capabilities.shell && capabilities.shell.mode) || 'none'),
    uiPreset: String(policy.uiPreset || ''),
    terminalBackends: Array.isArray(terminal.backends) ? terminal.backends.length : 0,
    disabledTools: Array.isArray(policy.disabledTools) ? policy.disabledTools.length : 0,
    dshHomeWritable: env.dshHomeWritable === true,
    node: String(env.node || ''),
    effective: {
      shell: effective.shell === true,
      terminal: effective.terminal === true,
      ui: effective.ui === true,
      image: effective.image === true,
    },
  }
}
