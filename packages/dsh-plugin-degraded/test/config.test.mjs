import { test } from 'node:test'
import assert from 'node:assert/strict'

import { normalizeConfig } from '../lib/config.js'

test('defaults every switch to auto and every flag to its safe default', () => {
  const config = normalizeConfig()
  assert.deepEqual(
    { shell: config.shell, ui: config.ui, terminal: config.terminal, image: config.image },
    { shell: 'auto', ui: 'auto', terminal: 'auto', image: 'auto' },
  )
  assert.equal(config.report.promptSection, true)
  assert.equal(config.report.command, true)
  assert.equal(config.server.allowRemote, false)
  assert.equal(config.client.statusBar, true)
  assert.deepEqual(config.warnings, [])
})

test('keeps valid tri-states and presets', () => {
  const config = normalizeConfig({ shell: 'off', ui: 'full', terminal: 'on', image: 'off' })
  assert.equal(config.shell, 'off')
  assert.equal(config.ui, 'full')
  assert.equal(config.terminal, 'on')
  assert.equal(config.image, 'off')
})

test('maps ui on/off to presets', () => {
  assert.equal(normalizeConfig({ ui: 'on' }).ui, 'full')
  assert.equal(normalizeConfig({ ui: 'off' }).ui, 'minimal')
})

test('warns about garbage instead of throwing', () => {
  const config = normalizeConfig({ shell: 'yes', ui: 'ultra', terminal: 42, image: null })
  assert.equal(config.shell, 'auto')
  assert.equal(config.ui, 'auto')
  assert.equal(config.terminal, 'auto')
  assert.equal(config.image, 'auto')
  assert.equal(config.warnings.length, 4)
})

test('reads nested booleans and ignores wrong types', () => {
  const config = normalizeConfig({
    report: { promptSection: false, command: 'yes' },
    server: { allowRemote: true },
    client: { statusBar: false },
  })
  assert.equal(config.report.promptSection, false)
  assert.equal(config.report.command, true)
  assert.equal(config.server.allowRemote, true)
  assert.equal(config.client.statusBar, false)
})
