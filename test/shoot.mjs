#!/usr/bin/env node
/**
 * dsh-rescue · headless screenshot / probe for the running web UI.
 *
 * Owns its own Edge instance (separate user-data-dir), signs the browser-session
 * cookie from `<home>/.credentials.yaml`, then screenshots and/or evaluates an
 * expression. Same approach as the Frutiger Aero skin's shoot.mjs, trimmed to
 * what the rescue profile needs.
 *
 *   node test/shoot.mjs --home <runtime>/home --out test/minimal.png
 *   node test/shoot.mjs --home <runtime>/home --eval-file test/perf.js
 *   node test/shoot.mjs --url http://127.0.0.1:3080/ --eval "document.title"
 */

import { spawn } from 'node:child_process'
import { createHash, createHmac } from 'node:crypto'
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'

import { REPO_ROOT, RUNTIME_DIR, parseArgs } from '../scripts/_shared.mjs'

const args = parseArgs()
const url = String(args.url || process.env.DSH_RESCUE_URL || 'http://127.0.0.1:3080/')
const home = String(args.home || process.env.DSH_RESCUE_HOME || join(RUNTIME_DIR, 'home'))
const out = resolve(REPO_ROOT, String(args.out || 'test/rescue-ui.png'))
const width = Number(args.width || 1440)
const height = Number(args.height || 900)
const port0 = Number(args.port || 47121)
const timeout = Number(args.timeout || 60) * 1000
const keepOpen = args.keep === true
const evalCode = args.eval === undefined || args.eval === true ? null : String(args.eval)
const evalFile = args['eval-file'] === undefined || args['eval-file'] === true ? null : String(args['eval-file'])

const EDGE = process.env.DSH_RESCUE_EDGE || process.env.EDGE_PATH || 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe'

const sleep = (ms) => new Promise((done) => setTimeout(done, ms))
const b64url = (buffer) => Buffer.from(buffer).toString('base64').split('+').join('-').split('/').join('_').replace(/=+$/u, '')

function readSecret() {
  const file = join(home, '.credentials.yaml')
  const text = readFileSync(file, 'utf8')
  const at = text.indexOf('client-connection/browser-session:')
  if (at === -1) throw new Error(`browser-session credential missing in ${file}`)
  const match = /secret:\s*([A-Za-z0-9_-]+)/u.exec(text.slice(at))
  if (!match) throw new Error(`browser-session secret missing in ${file}`)
  return Buffer.from(match[1].split('-').join('+').split('_').join('/'), 'base64')
}

function cookieFor(target, secret, days = 7) {
  const authority = new URL(target).host
  const name = `dsh-auth-${b64url(createHash('sha256').update(authority).digest())}`
  const issuedAt = Date.now()
  const expiresAt = issuedAt + days * 864e5
  const body = b64url(Buffer.from(JSON.stringify({ version: 1, authority, issuedAt, expiresAt }), 'utf8'))
  const sig = b64url(createHmac('sha256', secret).update(body).digest())
  return { name, value: `v1.${body}.${sig}` }
}

async function waitPort(port, tries) {
  for (let index = 0; index < tries; index += 1) {
    try {
      const response = await fetch(`http://127.0.0.1:${port}/json/version`)
      if (response.ok) return await response.json()
    } catch {
      /* not up yet */
    }
    await sleep(250)
  }
  return null
}

class Cdp {
  constructor(ws) {
    this.ws = ws
    this.id = 0
    this.pending = new Map()
    ws.addEventListener('message', (event) => {
      const message = JSON.parse(event.data)
      if (message.id === undefined) return
      const pending = this.pending.get(message.id)
      if (!pending) return
      this.pending.delete(message.id)
      if (message.error) pending.reject(new Error(`cdp error: ${JSON.stringify(message.error)}`))
      else pending.resolve(message.result)
    })
  }

  send(method, params) {
    const id = ++this.id
    this.ws.send(JSON.stringify({ id, method, params: params || {} }))
    return new Promise((resolve, reject) => this.pending.set(id, { resolve, reject }))
  }
}

function launch(port) {
  const profile = join(REPO_ROOT, 'runtime', `.edge-profile-${port}`)
  rmSync(profile, { recursive: true, force: true })
  const proc = spawn(
    EDGE,
    [
      '--headless=new',
      `--remote-debugging-port=${port}`,
      `--user-data-dir=${profile}`,
      '--no-first-run',
      '--no-default-browser-check',
      '--disable-sync',
      '--disable-extensions',
      '--disable-background-networking',
      '--hide-scrollbars',
      '--force-device-scale-factor=1',
      `--window-size=${width},${height}`,
      '--enable-unsafe-swiftshader',
      'about:blank',
    ],
    { stdio: ['ignore', 'pipe', 'pipe'] },
  )
  proc.stdout?.resume()
  proc.stderr?.resume()
  return proc
}

async function main() {
  const secret = readSecret()
  let proc = null
  let port = 0

  for (const candidate of [port0, port0 + 1, port0 + 2, port0 + 3]) {
    proc = launch(candidate)
    if (await waitPort(candidate, 40)) {
      port = candidate
      break
    }
    try {
      proc.kill()
    } catch {
      /* gone */
    }
  }
  if (!port) throw new Error('no DevTools port could be opened')

  const list = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json()
  const target = list.find((item) => item.type === 'page')
  if (!target) throw new Error('no page target')

  const ws = new WebSocket(target.webSocketDebuggerUrl)
  await new Promise((resolve, reject) => {
    ws.addEventListener('open', resolve)
    ws.addEventListener('error', reject)
  })
  const cdp = new Cdp(ws)

  await cdp.send('Page.enable')
  await cdp.send('Network.enable')
  await cdp.send('Runtime.enable')
  await cdp.send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: false })

  const cookie = cookieFor(url, secret)
  await cdp.send('Network.setCookie', { name: cookie.name, value: cookie.value, url, path: '/', httpOnly: false })

  let loaded = false
  ws.addEventListener('message', (event) => {
    try {
      if (JSON.parse(event.data).method === 'Page.loadEventFired') loaded = true
    } catch {
      /* ignore */
    }
  })

  await cdp.send('Page.navigate', { url })
  const started = Date.now()
  while (!loaded && Date.now() - started < timeout) await sleep(200)

  // Wait for the shell to mount something into #root.
  for (let index = 0; index < 100; index += 1) {
    const probe = await cdp.send('Runtime.evaluate', {
      expression: 'JSON.stringify({ready:document.readyState,root:(document.querySelector("#root")||{childElementCount:0}).childElementCount})',
      returnByValue: true,
    })
    let state
    try {
      state = JSON.parse(probe.result.value)
    } catch {
      state = null
    }
    if (state && state.ready === 'complete' && state.root > 0) break
    await sleep(150)
  }
  await sleep(700)

  let expression = evalCode
  if (evalFile) expression = readFileSync(resolve(REPO_ROOT, evalFile), 'utf8')

  if (expression) {
    const result = await cdp.send('Runtime.evaluate', {
      expression,
      returnByValue: true,
      awaitPromise: true,
    })
    const value = result.result.value === undefined ? result.result : result.result.value
    console.log(JSON.stringify(value, null, 1))
  }

  if (!args['no-shot']) {
    mkdirSync(dirname(out), { recursive: true })
    const shot = await cdp.send('Page.captureScreenshot', { format: 'png', fromSurface: true })
    writeFileSync(out, Buffer.from(shot.data, 'base64'))
    console.log('shot:', out, 'port', port)
  }

  if (!keepOpen) {
    try {
      proc.kill()
    } catch {
      /* gone */
    }
  }
  process.exit(0)
}

main().catch((error) => {
  console.error('shoot failed:', String((error && error.message) || error))
  process.exit(1)
})
