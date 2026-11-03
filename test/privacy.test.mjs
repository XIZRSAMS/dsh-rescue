import { test } from 'node:test'
import assert from 'node:assert/strict'

import { scanRepository } from '../scripts/privacy-scan.mjs'

test('the working tree has no forbidden binaries, keys or personal paths', () => {
  const result = scanRepository({ strict: false })
  assert.deepEqual(result.violations, [])
  assert.ok(result.scanned > 10, `expected to scan a few files, scanned ${result.scanned}`)
})

test('every forbidden-name file is git-ignored', async () => {
  const { readFileSync } = await import('node:fs')
  const ignore = readFileSync(new URL('../.gitignore', import.meta.url), 'utf8')
  for (const name of ['config.json', '.credentials.yaml']) {
    assert.ok(ignore.includes(name), `.gitignore must ignore ${name}`)
  }
  for (const pattern of ['*.exe', '*.iso', '*.wim', 'runtime/', 'node_modules/']) {
    assert.ok(ignore.includes(pattern), `.gitignore must contain ${pattern}`)
  }
})
