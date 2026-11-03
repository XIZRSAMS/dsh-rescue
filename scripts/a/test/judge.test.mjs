import { test } from 'node:test'
import assert from 'node:assert/strict'

import { PROBE_KEYS, caseOk, classifyRun, summarizeCapabilities, validateProbeRecord } from '../lib/judge.mjs'

test('validateProbeRecord requires every contract key', () => {
  const full = { shell: {}, terminal: {}, ui: {}, image: {}, env: {} }
  assert.deepEqual(validateProbeRecord(full), { ok: true, missing: [] })
  assert.deepEqual(validateProbeRecord({ shell: {}, terminal: {}, ui: {} }).missing, ['image', 'env'])
  assert.deepEqual(validateProbeRecord(null).missing, [...PROBE_KEYS])
  assert.equal(validateProbeRecord({ shell: 'pwsh', terminal: {}, ui: {}, image: {}, env: {} }).ok, false)
})

test('classifyRun separates degrade / fail-fast / hang / crash', () => {
  assert.equal(classifyRun({ responded: true }), 'degrade')
  assert.equal(classifyRun({ responded: false, exitCode: 1, tail: 'EACCES: DSH_HOME is not writable' }), 'fail-fast')
  assert.equal(classifyRun({ responded: false, exitCode: null, timedOut: true }), 'hang')
  assert.equal(classifyRun({ responded: false, exitCode: 0 }), 'crash')
  assert.equal(classifyRun({ responded: false, exitCode: 7, tail: '   ' }), 'crash')
})

test('caseOk accepts a controlled refusal but never a hang', () => {
  assert.equal(caseOk('degrade'), true)
  assert.equal(caseOk('fail-fast'), true)
  assert.equal(caseOk('hang'), false)
  assert.equal(caseOk('crash'), false)
  assert.equal(caseOk('fail-fast', ['degrade']), false)
  assert.equal(caseOk('degrade', ['degrade']), true)
})

test('summarizeCapabilities stays path-free and token-free', () => {
  const summary = summarizeCapabilities({
    capabilities: {
      shell: { mode: 'powershell' },
      terminal: { backends: ['pty'] },
      env: { dshHomeWritable: true, node: 'v22.20.0', dshHome: 'X:/secret' },
    },
    policy: {
      uiPreset: 'minimal',
      disabledTools: ['terminal_open'],
      effective: { shell: true, terminal: false, ui: false, image: true },
    },
  })
  assert.deepEqual(summary, {
    shellMode: 'powershell',
    uiPreset: 'minimal',
    terminalBackends: 1,
    disabledTools: 1,
    dshHomeWritable: true,
    node: 'v22.20.0',
    effective: { shell: true, terminal: false, ui: false, image: true },
  })
  assert.ok(!JSON.stringify(summary).includes('secret'))
})
