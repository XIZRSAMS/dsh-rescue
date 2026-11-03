#!/usr/bin/env node
/**
 * Build the tray launcher (launcher/Program.cs -> dist/dsh-rescue.exe).
 *
 * Uses the .NET Framework csc that ships with Windows; no SDK required.
 * The launcher is a GUI-subsystem exe: double-click starts the kernel, waits
 * for /dsh-rescue/capabilities.json, then opens the tokenised URL.
 *
 * The same source can be built for PE as a plain script launcher instead:
 * PE has no .NET unless WinPE-NetFx is added, so PE boots use start.cmd.
 */

import { spawnSync } from 'node:child_process'
import { existsSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'

import { REPO_ROOT } from './_shared.mjs'

const CSC_CANDIDATES = [
  'C:\\Windows\\Microsoft.NET\\Framework64\\v4.0.30319\\csc.exe',
  'C:\\Windows\\Microsoft.NET\\Framework\\v4.0.30319\\csc.exe',
]

const csc = CSC_CANDIDATES.find((candidate) => existsSync(candidate))
if (!csc) {
  console.error('[dsh-rescue] 找不到 csc.exe（.NET Framework 4.x）。Windows 10/11 自带的那个通常在 Framework64\\v4.0.30319。')
  process.exit(1)
}

const dist = join(REPO_ROOT, 'dist')
mkdirSync(dist, { recursive: true })

const out = join(dist, 'dsh-rescue.exe')
const result = spawnSync(
  csc,
  [
    '/nologo',
    '/target:winexe',
    '/optimize+',
    '/out:' + out,
    '/r:System.Windows.Forms.dll',
    '/r:System.Drawing.dll',
    join(REPO_ROOT, 'launcher', 'Program.cs'),
  ],
  { encoding: 'utf8' },
)

if (result.status !== 0) {
  console.error(result.stdout || '')
  console.error(result.stderr || '')
  process.exit(result.status === null ? 1 : result.status)
}

console.log('[dsh-rescue] launcher -> ' + out)
