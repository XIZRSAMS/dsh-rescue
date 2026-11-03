import { test } from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { REPO_ROOT } from '../scripts/_shared.mjs'

const read = (...parts) => readFileSync(join(REPO_ROOT, ...parts), 'utf8')

test('dsh-version.json is the single upstream version source', () => {
  const info = JSON.parse(read('dsh-version.json'))
  assert.match(info.kernelVersion, /^\d+\.\d+\.\d+/u)
  assert.equal(info.kernelPackage, '@deepseek-ai/dsh')
  assert.ok(info.nodeVersion)
})

test('profile manifest lists the three bundles and a file: dependency', () => {
  const manifest = JSON.parse(read('profiles', 'package.json'))
  assert.deepEqual(manifest.dsh.profile.bundles, [
    '@deepseek-ai/dsh-base',
    '@deepseek-ai/dsh-web-app',
    'dsh-plugin-degraded',
  ])
  assert.match(manifest.dependencies['dsh-plugin-degraded'], /^file:/u)
})

test('minimal layer disables the official heavy rows', () => {
  const patch = read('profiles', 'minimal.patch.yml')
  for (const id of ['ui-sidebar-documentpreview', 'ui-sidebar-browser']) {
    const section = new RegExp(`- id: ${id}\\s*\\n\\s*disabled: true`, 'u')
    assert.match(patch, section, `${id} should be disabled in minimal`)
  }
  // Third-party rows are emitted only when the package is installed.
  assert.doesNotMatch(patch, /ui-skin-frutiger-aero/u)
})

test('decoration map covers the common skin/wallpaper/widget packages', () => {
  const map = JSON.parse(read('profiles', 'decorations.json'))
  const ids = map.decorations.map((entry) => entry.rowId)
  for (const id of ['ui-skin-frutiger-aero', 'dsh-plugin-wallpaper-engine', 'dsh-pet', 'meow-smooth', 'picturereader']) {
    assert.ok(ids.includes(id), `${id} should be in decorations.json`)
  }
  for (const entry of map.decorations) {
    assert.match(entry.package, /^(@[\w.-]+\/)?[\w.-]+$/u, `bad package name: ${entry.package}`)
    assert.match(entry.rowId, /^[\w.-]+$/u, `bad row id: ${entry.rowId}`)
  }
})

test('full overlay re-enables heavy rows and pins ui: full', () => {
  const patch = read('profiles', 'full.patch.yml')
  assert.match(patch, /ui: full/u)
  assert.match(patch, /- id: ui-sidebar-documentpreview\s*\n\s*disabled: false/u)
  // A patch replaces the whole config, so the overlay must restate every switch.
  for (const key of ['shell', 'terminal', 'image']) {
    assert.match(patch, new RegExp(`^\\s*${key}: auto$`, 'mu'), `full overlay must restate ${key}`)
  }
})

test('setup --dry-run renders the plugin config with the chosen preset', () => {
  const result = spawnSync(process.execPath, [join(REPO_ROOT, 'scripts', 'setup.mjs'), '--dry-run'], {
    encoding: 'utf8',
    cwd: REPO_ROOT,
  })
  assert.equal(result.status, 0, result.stderr)
  assert.match(result.stdout, /- id: rescue-degraded/u)
  assert.match(result.stdout, /ui: minimal/u)
  assert.match(result.stdout, /ui-sidebar-documentpreview\s*\n\s*disabled: true/u)
  assert.match(result.stdout, /plugin spec\s+file:\.\./u, 'the plugin spec must stay relative')
})

test('the bundle patch mounts exactly one row', () => {
  const patch = read('packages', 'dsh-plugin-degraded', 'cordis.patch.yml')
  const ids = [...patch.matchAll(/- id: (\S+)/gu)].map((match) => match[1])
  assert.deepEqual(ids, ['rescue-degraded'])
})

test('decodeBuffer survives PowerShell redirection (UTF-16LE + BOM)', async () => {
  const { decodeBuffer } = await import('../scripts/_shared.mjs')
  const text = '# composed\n- id: rescue-degraded\n'
  const utf16 = Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from(text, 'utf16le')])
  assert.equal(decodeBuffer(utf16), text)

  const utf8Bom = Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from(text, 'utf8')])
  assert.equal(decodeBuffer(utf8Bom), text)

  assert.equal(decodeBuffer(Buffer.from(text, 'utf8')), text)
})
