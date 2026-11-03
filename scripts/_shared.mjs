/**
 * Shared helpers for the dsh-rescue scripts.
 *
 * No third-party dependency: every script here must run on a rescue machine that
 * may have no package store at all.
 */

import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'

/** Absolute path of the repository root (this file lives in <repo>/scripts). */
export const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')

export const RUNTIME_DIR = join(REPO_ROOT, 'runtime')
export const DEFAULT_HOME = join(RUNTIME_DIR, 'home')
export const DEFAULT_PROFILE = 'rescue'

/** Prefix for every script log line. */
export function log(...args) {
  console.log('[dsh-rescue]', ...args)
}

/** Warn without failing. */
export function warn(...args) {
  console.warn('[dsh-rescue] warn:', ...args)
}

/** Print and exit non-zero. */
export function fail(message, code = 1) {
  console.error('[dsh-rescue] error:', message)
  process.exit(code)
}

/**
 * Tiny argv parser.
 *
 *   --flag              → true
 *   --no-flag           → false
 *   --key value         → 'value'
 *   --key=value         → 'value'
 *   positional words    → `_` array
 */
export function parseArgs(argv = process.argv.slice(2)) {
  const result = { _: [] }
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index]
    if (!token.startsWith('--')) {
      result._.push(token)
      continue
    }
    if (token.startsWith('--no-')) {
      result[token.slice(5)] = false
      continue
    }
    const body = token.slice(2)
    const equals = body.indexOf('=')
    if (equals !== -1) {
      result[body.slice(0, equals)] = body.slice(equals + 1)
      continue
    }
    const next = argv[index + 1]
    if (next !== undefined && !next.startsWith('--')) {
      result[body] = next
      index += 1
      continue
    }
    result[body] = true
  }
  return result
}

/**
 * Decode a text file defensively.
 *
 * PowerShell redirection (`>` / `Out-File`) writes UTF-16LE with a BOM on
 * Windows PowerShell 5.1, and some editors still add a UTF-8 BOM. Node's
 * `readFileSync(path, 'utf8')` strips neither, so a report file produced by a
 * shell would silently look like NUL-separated garbage.
 */
export function decodeBuffer(buffer) {
  if (buffer.length >= 2 && buffer[0] === 0xff && buffer[1] === 0xfe) {
    return buffer.subarray(2).toString('utf16le')
  }
  if (buffer.length >= 2 && buffer[0] === 0xfe && buffer[1] === 0xff) {
    const swapped = Buffer.from(buffer.subarray(2))
    swapped.swap16()
    return swapped.toString('utf16le')
  }
  const text = buffer.toString('utf8')
  return text.charCodeAt(0) === 0xfeff ? text.slice(1) : text
}

/** Read JSON, returning `fallback` when the file is missing or invalid. */
export function readJson(path, fallback = undefined) {
  const text = readText(path)
  if (text === '') return fallback
  try {
    return JSON.parse(text)
  } catch {
    return fallback
  }
}

/** Read UTF-8 / UTF-16 text, returning '' when missing. */
export function readText(path) {
  try {
    return decodeBuffer(readFileSync(path))
  } catch {
    return ''
  }
}

/** Create parent directories. */
export function ensureDir(path) {
  mkdirSync(path, { recursive: true })
  return path
}

/** Write UTF-8 text with no BOM (Node's default) and a trailing newline. */
export function writeText(path, text) {
  ensureDir(dirname(path))
  const normalized = text.endsWith('\n') ? text : `${text}\n`
  writeFileSync(path, normalized, { encoding: 'utf8' })
  return path
}

/** Write pretty JSON with a trailing newline. */
export function writeJson(path, value) {
  return writeText(path, JSON.stringify(value, null, 2))
}

/** Whether a path exists (any type). */
export function exists(path) {
  try {
    statSync(path)
    return true
  } catch {
    return false
  }
}

/** Whether `child` resolves inside `parent`. */
export function isInside(child, parent) {
  const rel = relative(resolve(parent), resolve(child))
  return rel === '' || (!rel.startsWith(`..${sep}`) && rel !== '..' && !isAbsolute(rel))
}

/** Convert a Windows path to a slash form usable in a `file:` dependency. */
export function toPosixPath(path) {
  return path.split(sep).join('/')
}

/** Relative `file:` specifier from one directory to another. */
export function fileSpecifier(fromDir, target) {
  const rel = toPosixPath(relative(resolve(fromDir), resolve(target)))
  return `file:${rel.startsWith('.') ? rel : `./${rel}`}`
}

/**
 * Merge layered configuration.
 *
 *   CLI flag > environment variable > config.json > built-in default
 */
export function resolveLayers({ cli = {}, file = {}, env = process.env } = {}) {
  const pick = (cliKey, envKey, fileValue, fallback) => {
    if (cli[cliKey] !== undefined && cli[cliKey] !== true) return cli[cliKey]
    if (cli[cliKey] === true) return true
    const fromEnv = envKey ? env[envKey] : undefined
    if (fromEnv !== undefined && fromEnv !== '') return fromEnv
    if (fileValue !== undefined && fileValue !== null && fileValue !== '') return fileValue
    return fallback
  }

  const profile = file.profile || {}
  const server = file.server || {}
  const kernel = file.kernel || {}
  const capabilities = file.capabilities || {}
  const report = file.report || {}

  return {
    profile: {
      name: String(pick('profile', 'DSH_RESCUE_PROFILE', profile.name, DEFAULT_PROFILE)),
      ui: String(pick('ui', 'DSH_RESCUE_UI', profile.ui, 'minimal')).toLowerCase(),
    },
    server: {
      host: String(pick('host', 'DSH_RESCUE_HOST', server.host, '127.0.0.1')),
      port: String(pick('port', 'DSH_RESCUE_PORT', server.port, '3080')),
      openBrowser: pick('open', 'DSH_RESCUE_OPEN', server.openBrowser, false) === true,
    },
    kernel: {
      source: String(pick('kernel', 'DSH_RESCUE_KERNEL', kernel.source, 'npm')),
      vendorDir: String(pick('vendor-dir', 'DSH_RESCUE_VENDOR_DIR', kernel.vendorDir, '')),
      existing: String(pick('existing', 'DSH_RESCUE_EXISTING', kernel.existing, '')),
    },
    capabilities: {
      shell: String(pick('shell', 'DSH_RESCUE_SHELL', capabilities.shell, 'auto')),
      ui: String(pick('ui-mode', 'DSH_RESCUE_UI_MODE', capabilities.ui, 'auto')),
      terminal: String(pick('terminal', 'DSH_RESCUE_TERMINAL', capabilities.terminal, 'auto')),
      image: String(pick('image', 'DSH_RESCUE_IMAGE', capabilities.image, 'auto')),
    },
    report: {
      promptSection: report.promptSection !== false,
      command: report.command !== false,
    },
    home: String(pick('home', 'DSH_RESCUE_HOME', join(DEFAULT_HOME), DEFAULT_HOME)),
  }
}

/** Print a small table without dependencies. */
export function table(rows) {
  const width = rows.reduce((max, row) => Math.max(max, String(row[0]).length), 0)
  return rows.map(([key, value]) => `${String(key).padEnd(width)}  ${value}`).join('\n')
}
