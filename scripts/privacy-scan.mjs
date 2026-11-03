#!/usr/bin/env node
/**
 * dsh-rescue · privacy scan
 *
 * Fails when the repository contains something that must never be published:
 * binaries, disk images, API keys, private keys, personal absolute paths, or a
 * generated local config.
 *
 * `verify.mjs --privacy` imports `scanRepository`; running this file directly
 * prints the same report.
 */

import { readdirSync, readFileSync, statSync } from 'node:fs'
import { extname, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { REPO_ROOT } from './_shared.mjs'

const SKIP_DIRS = new Set(['.git', 'node_modules', 'runtime', 'dist', '.test-tmp', 'logs'])
const SKIP_EXT = new Set(['.png', '.jpg', '.jpeg', '.webp', '.gif', '.ico'])

const FORBIDDEN_EXT = new Set([
  '.exe',
  '.dll',
  '.tgz',
  '.tar',
  '.zip',
  '.7z',
  '.iso',
  '.wim',
  '.vhd',
  '.vhdx',
])

const FORBIDDEN_NAMES = new Set(['.credentials.yaml', 'settings.yaml'])

/** Generated local config: expected during development, guarded by .gitignore. */
const LOCAL_GENERATED_NAMES = new Set(['config.json', 'config.local.json'])

/** Patterns that must not appear in committed text. */
const CONTENT_RULES = [
  { id: 'deepseek-api-key', pattern: /\bsk-[A-Za-z0-9]{16,}/gu, note: 'looks like an API key' },
  { id: 'private-key', pattern: /BEGIN (?:RSA |OPENSSH |EC )?PRIVATE KEY/u, note: 'private key material' },
  { id: 'host-repo-path', pattern: /[A-Za-z]:\\DSH-Desktop-EAC2/gu, note: 'absolute path of the author machine' },
  { id: 'user-profile-path', pattern: /[A-Za-z]:\\Users\\[A-Za-z0-9._-]+/gu, note: 'absolute user profile path' },
]

const TEXT_EXT = new Set([
  '.md',
  '.txt',
  '.json',
  '.yml',
  '.yaml',
  '.js',
  '.mjs',
  '.cjs',
  '.ts',
  '.cmd',
  '.sh',
  '.ps1',
  '.html',
  '.css',
  '.svg',
  '.gitignore',
  '',
])

const isSelf = (absolutePath) => absolutePath.endsWith(join('scripts', 'privacy-scan.mjs'))

function walk(dir, out = []) {
  let entries
  try {
    entries = readdirSync(dir, { withFileTypes: true })
  } catch {
    return out
  }
  for (const entry of entries) {
    const absolute = join(dir, entry.name)
    if (entry.isDirectory()) {
      if (SKIP_DIRS.has(entry.name)) continue
      walk(absolute, out)
      continue
    }
    if (!entry.isFile()) continue
    if (isSelf(absolute)) continue
    out.push(absolute)
  }
  return out
}

/**
 * @param {{ root?: string, strict?: boolean }} [options]
 * @returns {{ ok: boolean, violations: Array<{ path: string, rule: string, note: string }>, skipped: string[], scanned: number }}
 */
export function scanRepository(options = {}) {
  const root = options.root || REPO_ROOT
  const strict = options.strict === true
  const files = walk(root)
  const violations = []
  const skipped = []
  let scanned = 0

  for (const absolute of files) {
    const rel = relative(root, absolute)
    const name = rel.split(/[\\/]/u).pop() || ''
    const ext = extname(name).toLowerCase()

    if (LOCAL_GENERATED_NAMES.has(name)) {
      skipped.push(`${rel} (local generated config, guarded by .gitignore)`)
      continue
    }
    if (FORBIDDEN_NAMES.has(name)) {
      // Locally generated: git-ignored, expected during development. A clean
      // clone must not contain it, so CI runs with --strict.
      if (strict) violations.push({ path: rel, rule: 'forbidden-name', note: `${name} is generated and must stay local` })
      else skipped.push(`${rel} (local, git-ignored)`)
      continue
    }
    if (FORBIDDEN_EXT.has(ext)) {
      violations.push({ path: rel, rule: 'forbidden-binary', note: `${ext} files are never committed` })
      continue
    }
    if (SKIP_EXT.has(ext)) continue

    let size = 0
    try {
      size = statSync(absolute).size
    } catch {
      continue
    }
    if (size > 512 * 1024) continue
    if (!TEXT_EXT.has(ext)) continue

    scanned += 1
    let text
    try {
      text = readFileSync(absolute, 'utf8')
    } catch {
      continue
    }
    for (const rule of CONTENT_RULES) {
      const matches = text.match(rule.pattern)
      if (!matches) continue
      violations.push({ path: rel, rule: rule.id, note: rule.note })
    }
  }

  return { ok: violations.length === 0, violations, skipped, scanned }
}

const invokedDirectly = (() => {
  try {
    return !!process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))
  } catch {
    return false
  }
})()

if (invokedDirectly) {
  const strict = process.argv.includes('--strict')
  const result = scanRepository({ strict })
  for (const entry of result.skipped) console.log(`[dsh-rescue] privacy: skip ${entry}`)
  if (result.ok) {
    console.log(`[dsh-rescue] privacy: ok (${result.scanned} text files scanned${strict ? ', strict' : ''})`)
    process.exit(0)
  }
  console.error('[dsh-rescue] privacy: FAILED')
  for (const violation of result.violations) {
    console.error(`  - ${violation.path}: ${violation.rule} (${violation.note})`)
  }
  process.exit(1)
}
