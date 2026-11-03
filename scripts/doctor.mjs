#!/usr/bin/env node
/**
 * dsh-rescue · doctor
 *
 * Prints the same probe result and the same decision the plugin makes at
 * runtime, plus the local file facts setup.mjs cares about. Safe: read-only.
 *
 *   node scripts/doctor.mjs [--json]
 */

import { join } from 'node:path'

import { REPO_ROOT, RUNTIME_DIR, exists, parseArgs, readJson, resolveLayers, table } from './_shared.mjs'
import { decideThisMachine, reportThisMachine } from './_probe.mjs'

const args = parseArgs()
const versionInfo = readJson(join(REPO_ROOT, 'dsh-version.json'), {})
const fileConfig = readJson(join(REPO_ROOT, 'config.json'), null)
const layers = resolveLayers({ cli: args, file: fileConfig || {} })

const profileDir = join(layers.home, 'profiles', layers.profile.name)
const kernelCandidate = join(RUNTIME_DIR, 'node_modules', '@deepseek-ai', 'dsh', 'lib', 'bin.js')

const config = {
  shell: layers.capabilities.shell,
  // Report the preset that will actually boot (profile layer wins over auto).
  ui: layers.profile.ui === 'auto' ? layers.capabilities.ui : layers.profile.ui,
  terminal: layers.capabilities.terminal,
  image: layers.capabilities.image,
  report: layers.report,
}

const result = decideThisMachine(config, {}, { dshRoot: join(RUNTIME_DIR, 'node_modules') })
const report = reportThisMachine(result, {
  rescueVersion: versionInfo.rescueVersion || '0.1.0',
  profile: layers.profile.name,
})

const facts = [
  ['node', process.version],
  ['platform', `${process.platform} ${process.arch}`],
  ['repo', REPO_ROOT],
  ['DSH_HOME (rescue)', layers.home],
  ['profile dir', profileDir],
  ['profile rendered', exists(join(profileDir, 'cordis.patch.yml'))],
  ['start.cmd', exists(join(REPO_ROOT, 'start.cmd'))],
  ['kernel', `${versionInfo.kernelPackage}@${versionInfo.kernelVersion}`],
  ['kernel present', exists(kernelCandidate)],
  ['config.json', exists(join(REPO_ROOT, 'config.json'))],
]

if (args.json === true) {
  console.log(
    JSON.stringify(
      {
        facts: Object.fromEntries(facts.map(([key, value]) => [key, value])),
        capabilities: report.json.capabilities,
        policy: report.json.policy,
      },
      null,
      2,
    ),
  )
  process.exit(0)
}

console.log('dsh-rescue doctor\n')
console.log(table(facts))
console.log('')
console.log(report.text)
