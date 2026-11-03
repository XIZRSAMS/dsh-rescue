/**
 * A-side helpers: logs, child processes, network and filesystem facts.
 *
 * Every module under scripts/a is dependency-free on purpose: it must run on the
 * rescue machine itself (portable Node, WinPE, no package store).
 */

import { spawn } from 'node:child_process'
import { createHash } from 'node:crypto'
import { createWriteStream, readFileSync, realpathSync, statfsSync } from 'node:fs'
import { join, resolve } from 'node:path'
import net from 'node:net'

import { RUNTIME_DIR, ensureDir, exists, writeJson } from '../../_shared.mjs'

/** Every A-side artefact lands here — never in the repository root. */
export const LOG_DIR = join(RUNTIME_DIR, 'logs')

export function logPath(name) {
  ensureDir(LOG_DIR)
  return join(LOG_DIR, name)
}

/** Write pretty JSON into runtime/logs and return the absolute path. */
export function writeLogJson(name, value) {
  const target = logPath(name)
  writeJson(target, value)
  return target
}

export function nowIso() {
  return new Date().toISOString()
}

export function sha256File(target) {
  if (!exists(target)) return ''
  try {
    return createHash('sha256').update(readFileSync(target)).digest('hex')
  } catch {
    return ''
  }
}

/** Keep the last N lines of a captured stream. */
export function tailLines(text, count = 20) {
  const lines = String(text || '').split(/\r?\n/u).filter((line) => line.trim().length > 0)
  return lines.slice(-Math.max(1, count)).join('\n')
}

/**
 * Poll a URL until it answers 2xx or the deadline passes. Never sleeps a fixed
 * budget: the interval shrinks so the last attempt still runs before the cutoff.
 */
export async function waitForHttp(url, options = {}) {
  const timeoutMs = Number(options.timeoutMs || 15000)
  const intervalMs = Number(options.intervalMs || 250)
  const started = Date.now()
  let lastError = ''
  let status = 0
  let attempts = 0

  while (Date.now() - started < timeoutMs) {
    if (typeof options.shouldStop === 'function' && options.shouldStop()) {
      return {
        ok: false,
        status,
        error: options.stopReason || 'stopped',
        elapsedMs: Date.now() - started,
        attempts,
        stopped: true,
      }
    }
    attempts += 1
    try {
      const response = await fetch(url, {
        headers: { accept: 'application/json' },
        signal: AbortSignal.timeout(Math.min(2000, Math.max(500, timeoutMs))),
      })
      status = response.status
      if (response.ok) {
        let body
        try {
          body = await response.json()
        } catch {
          body = undefined
        }
        return { ok: true, status, body, error: '', elapsedMs: Date.now() - started, attempts }
      }
      lastError = 'HTTP ' + response.status
    } catch (error) {
      lastError = String((error && error.message) || error)
    }
    const remaining = timeoutMs - (Date.now() - started)
    if (remaining <= 0) break
    await new Promise((resolve) => setTimeout(resolve, Math.min(intervalMs, remaining)))
  }

  return { ok: false, status, error: lastError, elapsedMs: Date.now() - started, attempts, timedOut: true }
}

/** Whether a TCP port can be bound right now. */
export function isPortFree(port, host = '127.0.0.1') {
  return new Promise((resolve) => {
    const server = net.createServer()
    server.once('error', () => resolve(false))
    server.listen({ port: Number(port), host, exclusive: true }, () => {
      server.close(() => resolve(true))
    })
  })
}

/** Ask the OS for an unused loopback port. */
export function freePort(host = '127.0.0.1') {
  return new Promise((resolve, reject) => {
    const server = net.createServer()
    server.once('error', reject)
    server.listen({ port: 0, host }, () => {
      const address = server.address()
      const port = address && typeof address === 'object' ? address.port : 0
      server.close(() => resolve(port))
    })
  })
}

/** Free space of the volume that holds the given path, in MiB. */
export function diskFreeMB(target) {
  try {
    const stats = statfsSync(target)
    return Math.round((Number(stats.bavail) * Number(stats.bsize)) / (1024 * 1024))
  } catch {
    return 0
  }
}

/** Run a command to completion and capture its output (bounded). */
export function runCapture(command, args, options = {}) {
  return new Promise((resolve) => {
    const started = Date.now()
    let stdout = ''
    let stderr = ''
    let child
    try {
      child = spawn(command, args, {
        cwd: options.cwd,
        env: options.env,
        stdio: ['ignore', 'pipe', 'pipe'],
        windowsHide: true,
      })
    } catch (error) {
      resolve({ code: null, signal: null, stdout, stderr, error: String((error && error.message) || error), elapsedMs: 0 })
      return
    }

    child.stdout?.on('data', (chunk) => {
      stdout = (stdout + String(chunk)).slice(-200000)
    })
    child.stderr?.on('data', (chunk) => {
      stderr = (stderr + String(chunk)).slice(-200000)
    })

    const timer = options.timeoutMs
      ? setTimeout(() => {
          killTree(child.pid, options.killOptions)
        }, Number(options.timeoutMs))
      : null

    const settle = (result) => {
      if (timer) clearTimeout(timer)
      resolve({ ...result, stdout, stderr, elapsedMs: Date.now() - started })
    }

    child.on('exit', (code, signal) => settle({ code, signal }))
    child.on('error', (error) => settle({ code: null, signal: null, error: String((error && error.message) || error) }))
  })
}

/**
 * Spawn a long-running service, stream its stdio into two log files, and keep a
 * bounded tail in memory for failure reporting.
 */
export function spawnService(command, args, options = {}) {
  const outPath = options.outPath || logPath('web.out')
  const errPath = options.errPath || logPath('web.err')
  ensureDir(LOG_DIR)

  const out = createWriteStream(outPath, { flags: 'w' })
  const err = createWriteStream(errPath, { flags: 'w' })

  const child = spawn(command, args, {
    cwd: options.cwd,
    env: options.env,
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
    windowsVerbatimArguments: options.windowsVerbatimArguments === true,
  })

  let outTail = ''
  let errTail = ''
  const keep = (current, chunk, limit = 65536) => (current + chunk).slice(-limit)

  child.stdout?.on('data', (chunk) => {
    const text = String(chunk)
    out.write(text)
    outTail = keep(outTail, text)
  })
  child.stderr?.on('data', (chunk) => {
    const text = String(chunk)
    err.write(text)
    errTail = keep(errTail, text)
  })

  const done = new Promise((resolve) => {
    child.on('exit', (code, signal) => {
      try {
        out.end()
        err.end()
      } catch {
        /* already closed */
      }
      resolve({ code, signal })
    })
    child.on('error', (error) => {
      try {
        out.end()
        err.end()
      } catch {
        /* already closed */
      }
      resolve({ code: null, signal: null, error: String((error && error.message) || error) })
    })
  })

  return {
    child,
    done,
    outPath,
    errPath,
    tail: () => ({ out: outTail, err: errTail }),
  }
}

/**
 * Kill a whole process tree.
 *
 * The taskkill path is resolved from the HOST environment on purpose: matrix
 * cases overwrite SystemRoot for the child, and the killer must not inherit it.
 */
export async function killTree(pid, options = {}) {
  if (!pid) return
  if (process.platform === 'win32') {
    const systemRoot = options.systemRoot || process.env.SystemRoot || 'C:\\Windows'
    const taskkill = join(systemRoot, 'System32', 'taskkill.exe')
    await new Promise((resolve) => {
      const child = spawn(taskkill, ['/pid', String(pid), '/t', '/f'], { stdio: 'ignore', windowsHide: true })
      child.on('exit', () => resolve())
      child.on('error', () => resolve())
    })
    return
  }
  try {
    process.kill(pid, 'SIGTERM')
  } catch {
    /* already gone */
  }
}

/**
 * Resolve a junction/symlink to its target, or '' when the path is a real
 * directory.
 *
 * Node's lstatSync().isSymbolicLink() reports false for an NTFS junction, and
 * readlinkSync throws on it. Comparing the real path with the literal one is the
 * portable check (measured: a junction resolves to its target, a real directory
 * to itself).
 */
export function linkTarget(target) {
  try {
    const real = realpathSync.native(target)
    return resolve(real).toLowerCase() !== resolve(target).toLowerCase() ? real : ''
  } catch {
    return ''
  }
}

/** True when the path is a junction or symlink (portable-copy hazard). */
export function isLink(target) {
  return linkTarget(target) !== ''
}
