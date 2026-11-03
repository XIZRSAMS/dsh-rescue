#!/usr/bin/env node
/**
 * dsh-pure · PE boot script.
 *
 * The WinPE shell in this environment has no ping/ipconfig/timeout, so the
 * launcher is plain Node: start the kernel, stream its output to web.log, watch
 * for the token, poll the loopback URL, then hand the URL to a browser.
 */

import { spawn } from 'node:child_process'
import { createWriteStream, existsSync, mkdirSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = dirname(fileURLToPath(import.meta.url))
const NODE = process.execPath
const KERNEL = join(ROOT, 'runtime', 'node_modules', '@deepseek-ai', 'dsh', 'lib', 'bin.js')
const HOME = join(ROOT, 'runtime', 'home')
const TMP = join(ROOT, 'runtime', 'tmp')
const LOGDIR = join(ROOT, 'runtime', 'logs')
const PORT = Number(process.env.DSH_PURE_PORT || 3080)

mkdirSync(TMP, { recursive: true })
mkdirSync(LOGDIR, { recursive: true })
const logPath = join(LOGDIR, 'web.log')
const logFile = createWriteStream(logPath, { flags: 'w' })

if (!existsSync(KERNEL)) {
  console.error('[dsh] kernel not found: ' + KERNEL)
  process.exit(2)
}

/** Read KEY=VALUE lines from apikey.txt (or a bare sk-... line). */
function loadCredentials() {
  const file = join(ROOT, 'apikey.txt')
  const extra = {}
  if (!existsSync(file)) return { extra, file, found: false }
  let text = ''
  try { text = readFileSync(file, 'utf8') } catch { return { extra, file, found: false } }
  for (const line of text.split(/\r?\n/)) {
    const pair = line.match(/^\s*([A-Za-z0-9_]+)\s*=\s*(.+?)\s*$/)
    if (pair) extra[pair[1]] = pair[2].replace(/^["']|["']$/g, '')
  }
  if (!extra.DEEPSEEK_API_KEY) {
    const bare = text.trim().match(/sk-[A-Za-z0-9_-]{16,}/)
    if (bare) extra.DEEPSEEK_API_KEY = bare[0]
  }
  return { extra, file, found: Boolean(extra.DEEPSEEK_API_KEY) }
}

/** Prefer the bundled Portable PowerShell 7 over whatever the PE has. */
const pwshDir = join(ROOT, 'pwsh')
const hasPwsh = existsSync(join(pwshDir, 'pwsh.exe'))
const childPath = hasPwsh ? pwshDir + ';' + (process.env.PATH || '') : process.env.PATH || ''
if (hasPwsh) console.log('[dsh] pwsh: ' + join(pwshDir, 'pwsh.exe'))
else console.log('[dsh] pwsh: not bundled (put PowerShell 7 in ' + pwshDir + ' to enable shell tools)')

const credentials = loadCredentials()
if (credentials.found) {
  console.log('[dsh] credentials: loaded from ' + credentials.file)
} else {
  console.log('[dsh] credentials: none found. Put your key in ' + credentials.file)
  console.log('               either  DEEPSEEK_API_KEY=sk-xxxx  or just the bare sk-xxxx line.')
}

console.log('[dsh] root   = ' + ROOT)
console.log('[dsh] node   = ' + NODE)
console.log('[dsh] home   = ' + HOME)
console.log('[dsh] log    = ' + logPath)
console.log('[dsh] starting kernel on 127.0.0.1:' + PORT + ' ...')

const child = spawn(
  NODE,
  [KERNEL, '--profile', 'web', '--host', '127.0.0.1', '--port', String(PORT), '--no-open'],
  {
    cwd: ROOT,
    env: { ...process.env, ...credentials.extra, PATH: childPath, DSH_HOME: HOME, TMP, TEMP: TMP },
    stdio: ['ignore', 'pipe', 'pipe'],
  },
)

let token = ''
const seen = []
function feed(chunk) {
  const text = chunk.toString()
  logFile.write(text)
  process.stdout.write(text)
  seen.push(text)
  if (!token) {
    const match = text.match(/token=([A-Za-z0-9_-]{8,})/)
    if (match) token = match[1]
  }
}
child.stdout.on('data', feed)
child.stderr.on('data', feed)

const deadline = Date.now() + 120000
async function waitReady() {
  while (Date.now() < deadline) {
    if (child.exitCode !== null) return false
    try {
      const controller = new AbortController()
      const timer = setTimeout(() => controller.abort(), 1500)
      const response = await fetch('http://127.0.0.1:' + PORT + '/', {
        signal: controller.signal,
        redirect: 'manual',
      })
      clearTimeout(timer)
      if (response.status > 0) return true
    } catch {
      /* not up yet */
    }
    await new Promise((resolve) => setTimeout(resolve, 500))
  }
  return false
}

function openBrowser(url) {
  const palemoon = join(ROOT, 'browser', 'Palemoon-Portable.exe')
  if (existsSync(palemoon)) {
    // Spawn the exe directly: going through "start" inside cmd is unreliable in PE.
    spawn(palemoon, [url], { stdio: 'ignore', detached: true }).unref()
    return 'bundled Pale Moon'
  }
  spawn('cmd', ['/c', 'start', '""', url], { stdio: 'ignore', detached: true, windowsHide: true }).unref()
  return 'default browser'
}

const ready = await waitReady()
if (!ready) {
  console.error('[dsh] kernel did not answer in 120s. last output:')
  console.error(seen.join('').split(/\r?\n/).slice(-20).join('\n'))
  console.error('[dsh] full log: ' + logPath)
  process.exit(1)
}

const url = 'http://127.0.0.1:' + PORT + '/' + (token ? '?token=' + token : '')
console.log('[dsh] url: ' + url)
console.log('[dsh] opening ' + openBrowser(url))

child.on('exit', (code) => {
  console.log('[dsh] kernel exited with ' + code)
  process.exit(code === null ? 1 : code)
})

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => {
    try { child.kill(signal) } catch { /* gone */ }
    process.exit(0)
  })
}
