import { test } from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, unlinkSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

import { REPO_ROOT, RUNTIME_DIR } from '../scripts/_shared.mjs'

// setup.mjs writes runtime/last-setup.json on every run; keep the developer's
// real snapshot intact so a test run cannot leave a dead .test-tmp path behind.
const LAST_SETUP = join(RUNTIME_DIR, 'last-setup.json')
const lastSetupBackup = existsSync(LAST_SETUP) ? readFileSync(LAST_SETUP) : null
process.on('exit', () => {
  try {
    if (lastSetupBackup) writeFileSync(LAST_SETUP, lastSetupBackup)
    else if (existsSync(LAST_SETUP)) unlinkSync(LAST_SETUP)
  } catch {
    /* best effort */
  }
})

const exists = (path) => {
  try {
    readFileSync(path)
    return true
  } catch {
    return false
  }
}

function renderHome(ui) {
  mkdirSync(RUNTIME_DIR, { recursive: true })
  const home = mkdtempSync(join(RUNTIME_DIR, '.test-tmp-'))
  const result = spawnSync(
    process.execPath,
    [
      join(REPO_ROOT, 'scripts', 'setup.mjs'),
      '--home',
      home,
      '--no-install',
      '--no-write-config',
      '--ui',
      ui,
      '--profile',
      'test-profile',
    ],
    { encoding: 'utf8', cwd: REPO_ROOT },
  )
  assert.equal(result.status, 0, result.stderr)
  return { home, profileDir: join(home, 'profiles', 'test-profile') }
}

test('setup renders a bootable profile directory', () => {
  const { home, profileDir } = renderHome('minimal')
  try {
    const manifest = JSON.parse(readFileSync(join(profileDir, 'package.json'), 'utf8'))
    assert.deepEqual(manifest.dsh.profile.bundles, [
      '@deepseek-ai/dsh-base',
      '@deepseek-ai/dsh-web-app',
      'dsh-plugin-degraded',
    ])
    assert.match(manifest.dependencies['dsh-plugin-degraded'], /^file:/u)

    const patch = readFileSync(join(profileDir, 'cordis.patch.yml'), 'utf8')
    assert.match(patch, /- id: rescue-degraded/u)
    assert.match(patch, /ui: minimal/u)
    assert.match(patch, /ui-sidebar-documentpreview\s*\n\s*disabled: true/u)

    assert.ok(exists(join(profileDir, 'cordis.yml')))
    assert.ok(exists(join(profileDir, 'pnpm-workspace.yaml')))
    assert.ok(exists(join(RUNTIME_DIR, 'start.cmd')))
    assert.ok(exists(join(RUNTIME_DIR, 'capabilities.json')))
  } finally {
    rmSync(home, { recursive: true, force: true })
  }
})

test('setup --ui full renders the full overlay into the profile layer', () => {
  const { home, profileDir } = renderHome('full')
  try {
    const patch = readFileSync(join(profileDir, 'cordis.patch.yml'), 'utf8')
    assert.match(patch, /ui: full/u)
    assert.match(patch, /ui-sidebar-documentpreview\s*\n\s*disabled: false/u)
  } finally {
    rmSync(home, { recursive: true, force: true })
  }
})

test('setup refuses to write into the running DSH_HOME', () => {
  const home = process.env.DSH_HOME
  if (!home) return
  const result = spawnSync(
    process.execPath,
    [join(REPO_ROOT, 'scripts', 'setup.mjs'), '--home', join(home, 'profiles', 'x'), '--dry-run'],
    { encoding: 'utf8', cwd: REPO_ROOT },
  )
  assert.notEqual(result.status, 0)
  assert.match(`${result.stdout}${result.stderr}`, /拒绝写入|refuse/iu)
})
