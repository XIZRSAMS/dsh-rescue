import { test } from 'node:test'
import assert from 'node:assert/strict'

import { detectShell, probeCapabilities } from '../lib/probe.js'

const winEnv = (overrides = {}) => ({
  SystemRoot: 'C:\\Windows',
  ProgramFiles: 'C:\\Program Files',
  DSH_HOME: 'D:\\rescue\\runtime\\home',
  PATH: 'C:\\Windows\\System32;C:\\Tools',
  ...overrides,
})

/** A deps double whose `pathExists` answers from a fixed set. */
function depsWith(existing, overrides = {}) {
  const set = new Set(existing)
  return {
    platform: 'win32',
    env: winEnv(overrides.env),
    pathExists: (path) => set.has(path),
    dirExists: (path) => set.has(path),
    canWrite: () => overrides.canWrite ?? true,
    terminalBackends: () => overrides.backends ?? ['pty'],
    ...overrides.deps,
  }
}

test('prefers PowerShell 7 when present', () => {
  const deps = depsWith(['C:\\Program Files\\PowerShell\\7\\pwsh.exe'])
  const shell = detectShell(deps)
  assert.equal(shell.mode, 'pwsh')
  assert.match(shell.executable, /pwsh\.exe$/u)
  assert.ok(shell.tried.length >= 1)
})

test('falls back to Windows PowerShell 5.1', () => {
  const deps = depsWith(['C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe'])
  const shell = detectShell(deps)
  assert.equal(shell.mode, 'powershell')
  assert.match(shell.executable, /powershell\.exe$/u)
})

test('falls back to cmd.exe when both PowerShells are missing', () => {
  const deps = depsWith(['C:\\Windows\\System32\\cmd.exe'])
  const shell = detectShell(deps)
  assert.equal(shell.mode, 'cmd')
  assert.match(shell.reason, /cmd/iu)
})

test('reports none when no shell exists', () => {
  const shell = detectShell(depsWith([]))
  assert.equal(shell.mode, 'none')
  assert.equal(shell.executable, '')
})

test('detects WinPE and forbids decorations', () => {
  const deps = depsWith(['C:\\Program Files\\PowerShell\\7\\pwsh.exe'], {
    env: { SystemRoot: 'X:\\Windows', SystemDrive: 'X:' },
  })
  const caps = probeCapabilities(deps)
  assert.equal(caps.env.isPE, true)
  assert.equal(caps.ui.gpu, false)
  assert.equal(caps.ui.decorationAllowed, false)
  assert.equal(caps.image.preview, false)
})

test('reports DSH_HOME writability both ways', () => {
  const writable = probeCapabilities(depsWith([], { canWrite: true }))
  assert.equal(writable.env.dshHomeWritable, true)

  const readOnly = probeCapabilities(depsWith([], { canWrite: false }))
  assert.equal(readOnly.env.dshHomeWritable, false)
  assert.ok(readOnly.env.reasons.some((reason) => /不可写/u.test(reason)))
})

test('detects ConPTY-capable PTY backends', () => {
  const caps = probeCapabilities(depsWith([], { backends: ['conpty', 'pwsh'] }))
  assert.equal(caps.terminal.conpty, true)
  assert.equal(caps.terminal.available, true)
  assert.deepEqual(caps.terminal.backends, ['conpty', 'pwsh'])

  const bare = probeCapabilities(depsWith([], { backends: [] }))
  assert.equal(bare.terminal.conpty, false)
  assert.equal(bare.terminal.available, false)
  assert.equal(bare.terminal.backends.length, 0)
})

test('an invisible Host-side terminal service is reported as unknown, not unavailable', () => {
  // A session preset registers its PTY backend inside an isolated realm, so the
  // Host may not see `terminals` at all. Guessing "unavailable" there would
  // wrongly hide working terminal tools.
  const invisible = probeCapabilities({
    ...depsWith([], { backends: [] }),
    hasTerminalService: () => false,
  })
  assert.equal(invisible.terminal.available, null)
  assert.match(invisible.terminal.reason, /默认不降级/u)
})

test('never leaks an absolute executable path in the report-facing name', () => {
  const caps = probeCapabilities(depsWith(['C:\\Program Files\\PowerShell\\7\\pwsh.exe']))
  assert.equal(caps.shell.name, 'pwsh.exe')
  assert.ok(!caps.shell.name.includes('\\'))
})
