#!/usr/bin/env node
/**
 * Rebuild the pwsh.exe shim used by the WinPE package.
 *
 *   node tools/seabuild/build.mjs [--out dist/pure/pwsh/pwsh.exe]
 *
 * The shim is a Node SEA executable that accepts PowerShell-style flags and
 * forwards the command to cmd.exe, so dsh-pwsh-local can spawn it on a PE that
 * has no PowerShell at all. Requires: npm i postject (already vendored here).
 */

import { copyFileSync, existsSync, mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'

const HERE = dirname(fileURLToPath(import.meta.url))
const ROOT = join(HERE, '..', '..')
const args = process.argv.slice(2)
const outArg = args.indexOf('--out')
const out = outArg >= 0 ? args[outArg + 1] : join(ROOT, 'dist', 'pure', 'pwsh', 'pwsh.exe')

mkdirSync(dirname(out), { recursive: true })

const blob = spawnSync(process.execPath, ['--experimental-sea-config', 'sea-config.json'], { cwd: HERE, encoding: 'utf8' })
if (blob.status !== 0) {
  console.error(blob.stdout || '', blob.stderr || '')
  process.exit(1)
}

const nodeExe = process.execPath
copyFileSync(nodeExe, out)

const inject = spawnSync(
  process.execPath,
  [
    join(HERE, 'node_modules', 'postject', 'dist', 'cli.js'),
    out,
    'NODE_SEA_BLOB',
    join(HERE, 'sea-prep.blob'),
    '--sentinel-fuse',
    'NODE_SEA_FUSE_fce680ab2cc467b6e072b8b5df1996b2',
  ],
  { encoding: 'utf8' },
)
if (inject.status !== 0) {
  console.error(inject.stdout || '', inject.stderr || '')
  process.exit(1)
}
console.log('[seabuild] wrote ' + out)
