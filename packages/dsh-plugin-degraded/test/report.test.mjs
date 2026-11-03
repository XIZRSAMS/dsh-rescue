import { test } from 'node:test'
import assert from 'node:assert/strict'

import { renderJson, renderReport } from '../lib/report.js'
import { decide } from '../lib/policy.js'

const capabilities = {
  shell: { mode: 'powershell', executable: 'C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe', name: 'powershell.exe', reason: '仅有 Windows PowerShell 5.1' },
  terminal: { conpty: false, backends: [], reason: '没有注册任何 PTY 后端' },
  ui: { gpu: false, decorationAllowed: false, reason: 'WinPE 环境：默认关闭全部装饰层' },
  image: { preview: false, mediaTypes: ['image/png', 'image/jpeg'], reason: 'WinPE：无预览渲染管线' },
  env: {
    isPE: true,
    dshHome: 'X:\\dsh-home',
    dshHomeWritable: true,
    platform: 'win32',
    arch: 'x64',
    node: 'v22.20.0',
    reasons: ['SystemRoot 在 X:'],
  },
}

const policy = decide(capabilities, {})
const meta = { rescueVersion: '0.1.0', profile: 'rescue', generatedAt: 1700000000000 }

test('renders a redacted report with no absolute paths', () => {
  const report = renderReport({ capabilities, policy, meta })
  assert.match(report.text, /环境报告/u)
  assert.match(report.text, /WinPE: 是/u)
  assert.match(report.text, /UI 预设: minimal/u)
  assert.ok(!/[A-Za-z]:\\\\/u.test(report.text), 'report must not contain a drive-qualified path')
  assert.ok(!report.text.includes('X:\\dsh-home'), 'report must not leak DSH_HOME')
  assert.ok(!report.text.includes('C:\\Windows'), 'report must not leak the executable path')
})

test('carries the disabled tool list into the text', () => {
  const report = renderReport({ capabilities, policy, meta })
  for (const name of policy.disabledTools) {
    assert.ok(report.text.includes(name), `${name} should be listed`)
  }
})

test('json payload exposes the stable public shape', () => {
  const json = renderJson({ capabilities, policy, meta })
  assert.equal(json.reportVersion, 1)
  assert.equal(json.generatedAt, 1700000000000)
  assert.equal(json.profile, 'rescue')
  assert.equal(json.policy.uiPreset, 'minimal')
  assert.equal(json.capabilities.env.isPE, true)
  // powershell.exe exists, so the shell capability itself stays enabled.
  assert.deepEqual(json.policy.effective, { shell: true, terminal: false, ui: false, image: false })
  assert.ok(Array.isArray(json.policy.disabledFeatures))
  assert.ok(json.policy.disabledFeatures.includes('rain'))
  assert.ok(!JSON.stringify(json).includes('X:\\\\dsh-home'))
})

test('tolerates empty input without throwing', () => {
  const json = renderJson({})
  assert.equal(json.policy.uiPreset, 'minimal')
  assert.deepEqual(json.capabilities.env.reasons, [])
  const report = renderReport({})
  assert.match(report.text, /环境报告/u)
})
