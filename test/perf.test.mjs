import { test } from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { join } from 'node:path'

import { REPO_ROOT, RUNTIME_DIR } from '../scripts/_shared.mjs'

const EDGE =
  process.env.DSH_RESCUE_EDGE || process.env.EDGE_PATH || 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe'

const home = process.env.DSH_RESCUE_HOME || join(RUNTIME_DIR, 'home')
const url = process.env.DSH_RESCUE_URL || ''

/** Thresholds are the documented acceptance criteria for the minimal preset. */
const LIMITS = {
  loadEventEndMs: Number(process.env.DSH_RESCUE_PERF_BUDGET) || 3000,
  usedJSHeapMB: 400,
  // "no continuous requestAnimationFrame": a 3s sample must stay below ~10fps.
  framesIn3s: 30,
}

const canRun = () =>
  Boolean(url) &&
  process.env.DSH_RESCUE_SKIP_BROWSER !== '1' &&
  existsSync(EDGE) &&
  existsSync(join(home, '.credentials.yaml'))

test('minimal preset meets the first-screen budget', { skip: canRun() ? false : 'DSH_RESCUE_URL not set, no Edge, or DSH_RESCUE_SKIP_BROWSER=1' }, () => {
  const result = spawnSync(
    process.execPath,
    [
      join(REPO_ROOT, 'test', 'shoot.mjs'),
      '--url',
      url,
      '--home',
      home,
      '--no-shot',
      '--eval-file',
      join('test', 'perf.js'),
      '--timeout',
      '90',
    ],
    { encoding: 'utf8', cwd: REPO_ROOT, timeout: 180_000 },
  )

  assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`)
  // shoot.mjs prints metrics with JSON.stringify(value, null, 1), so the object
  // spans several lines; take the last complete object, not one line.
  const text = String(result.stdout || '')
  const start = text.lastIndexOf('{')
  const end = text.lastIndexOf('}')
  assert.ok(start >= 0 && end > start, `shoot.mjs produced no JSON: ${result.stdout}`)

  const metrics = JSON.parse(text.slice(start, end + 1))
  for (const [key, limit] of Object.entries(LIMITS)) {
    if (metrics[key] === null || metrics[key] === undefined) continue
    assert.ok(metrics[key] <= limit, `${key}=${metrics[key]} exceeds ${limit}`)
  }
  assert.equal(metrics.decorationNodes, 0, 'minimal preset must not mount decoration nodes')
})
