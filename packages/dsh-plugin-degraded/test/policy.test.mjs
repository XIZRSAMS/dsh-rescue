import { test } from 'node:test'
import assert from 'node:assert/strict'

import { decide, intersectTools, normalizeTri, normalizeUiSwitch, resolveTri } from '../lib/policy.js'

/** A fully-capable probe result. */
const capableProbe = {
  shell: { mode: 'pwsh', executable: 'C:\\pwsh.exe', name: 'pwsh.exe', tried: [], reason: 'PowerShell 7 可用' },
  terminal: { conpty: true, backends: ['pty'], reason: 'PTY 后端可用' },
  ui: { gpu: true, decorationAllowed: true, reason: '桌面环境' },
  image: { preview: true, mediaTypes: ['image/png'], reason: '图片预览可用' },
  env: { isPE: false, dshHomeWritable: true, platform: 'win32', arch: 'x64', node: 'v22.20.0', reasons: [] },
}

/** A WinPE probe result. */
const peProbe = {
  shell: { mode: 'none', executable: '', name: '', tried: [], reason: '找不到任何 shell 可执行文件' },
  terminal: { conpty: false, backends: [], reason: '没有注册任何 PTY 后端' },
  ui: { gpu: false, decorationAllowed: false, reason: 'WinPE 环境：默认关闭全部装饰层' },
  image: { preview: false, mediaTypes: ['image/png'], reason: 'WinPE：无预览渲染管线' },
  env: { isPE: true, dshHomeWritable: true, platform: 'win32', arch: 'x64', node: 'v22.20.0', reasons: ['SystemRoot 在 X:'] },
}

test('normalizes tri-state values', () => {
  assert.equal(normalizeTri('ON'), 'on')
  assert.equal(normalizeTri(' off '), 'off')
  assert.equal(normalizeTri('yes'), 'auto')
})

test('normalizes the ui switch', () => {
  assert.equal(normalizeUiSwitch('full'), 'full')
  assert.equal(normalizeUiSwitch('on'), 'full')
  assert.equal(normalizeUiSwitch('minimal'), 'minimal')
  assert.equal(normalizeUiSwitch('off'), 'minimal')
  assert.equal(normalizeUiSwitch('auto'), 'auto')
  assert.equal(normalizeUiSwitch('nonsense'), 'auto')
})

test('resolveTri honours forced on/off over the probe', () => {
  assert.deepEqual(resolveTri('on', false, 'up', 'down'), {
    enabled: true,
    reason: 'config 强制开启（探测结论：down）',
  })
  assert.deepEqual(resolveTri('off', true, 'up', 'down'), {
    enabled: false,
    reason: 'config 强制关闭（探测结论：up）',
  })
  assert.deepEqual(resolveTri('auto', true, 'up', 'down'), { enabled: true, reason: 'up' })
  assert.deepEqual(resolveTri('auto', false, 'up', 'down'), { enabled: false, reason: 'down' })
})

test('capable environment stays fully enabled with the full preset', () => {
  const policy = decide(capableProbe, {})
  assert.deepEqual(policy.effective, { shell: true, terminal: true, ui: true, image: true })
  assert.equal(policy.uiPreset, 'full')
  assert.deepEqual(policy.disabledTools, [])
  assert.deepEqual(policy.disabledFeatures, [])
})

test('a missing shell disables the shell tools', () => {
  const policy = decide({ ...capableProbe, shell: { ...capableProbe.shell, mode: 'none' } }, {})
  assert.equal(policy.effective.shell, false)
  assert.ok(policy.disabledTools.includes('pwsh'))
  assert.ok(policy.disabledTools.includes('bash'))
  assert.match(policy.reasons.shell, /shell/u)
})

test('no PTY backends and no terminal service disables the terminal tools', () => {
  const policy = decide({ ...capableProbe, terminal: { available: false, conpty: false, backends: [], reason: '无' } }, {})
  assert.equal(policy.effective.terminal, false)
  for (const name of ['terminal_open', 'terminal_read', 'terminal_close']) {
    assert.ok(policy.disabledTools.includes(name), `${name} should be denied`)
  }
})

test('an unknown terminal capability is not degraded', () => {
  const policy = decide(
    { ...capableProbe, terminal: { available: null, conpty: false, backends: [], reason: 'Host 层看不到终端服务' } },
    {},
  )
  assert.equal(policy.effective.terminal, true)
  assert.ok(!policy.disabledTools.includes('terminal_open'))
})

test('an empty Host-side backend list does not disable a registered terminal service', () => {
  const policy = decide(
    { ...capableProbe, terminal: { available: true, conpty: false, backends: [], reason: '终端服务已注册' } },
    {},
  )
  assert.equal(policy.effective.terminal, true)
  assert.ok(!policy.disabledTools.includes('terminal_open'))
})

test('image preview off denies read_image', () => {
  const policy = decide({ ...capableProbe, image: { ...capableProbe.image, preview: false } }, {})
  assert.equal(policy.effective.image, false)
  assert.ok(policy.disabledTools.includes('read_image'))
})

test('forced off wins even when the probe says capable', () => {
  const policy = decide(capableProbe, { shell: 'off', terminal: 'off', image: 'off' })
  assert.deepEqual(policy.effective, { shell: false, terminal: false, ui: true, image: false })
})

test('config ui=minimal beats a capable probe; override beats config', () => {
  const fromConfig = decide(capableProbe, { ui: 'minimal' })
  assert.equal(fromConfig.uiPreset, 'minimal')
  assert.equal(fromConfig.effective.ui, false)
  assert.ok(fromConfig.disabledFeatures.includes('skin'))

  const overridden = decide(capableProbe, { ui: 'minimal' }, { uiPreset: 'full' })
  assert.equal(overridden.uiPreset, 'full')
  assert.equal(overridden.reasons.ui, '命令行 / 环境变量覆盖')
})

test('WinPE with auto config degrades to minimal', () => {
  const policy = decide(peProbe, {})
  assert.equal(policy.uiPreset, 'minimal')
  assert.equal(policy.effective.shell, false)
  assert.ok(policy.disabledFeatures.includes('canvas'))
  assert.ok(policy.notes.some((note) => /WinPE/u.test(note)))
})

test('intersectTools drops names the scope cannot see', () => {
  const deny = intersectTools(['pwsh', 'bash', 'terminal_open'], ['pwsh', 'terminal_open', 'read'])
  assert.deepEqual(deny, ['pwsh', 'terminal_open'])
  assert.deepEqual(intersectTools(['pwsh'], []), [])
  assert.deepEqual(intersectTools(undefined, ['pwsh']), [])
})
