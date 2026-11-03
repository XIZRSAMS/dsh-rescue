#!/usr/bin/env node
/**
 * Patch the client bundle for old engines (Pale Moon / Goanna).
 *
 * Pale Moon 34 lacks AbortSignal.any and AbortSignal.prototype.throwIfAborted,
 * which the connection module calls unconditionally:
 *   TypeError: AbortSignal.any is not a function
 *   ... signal.throwIfAborted is not a function
 * so the socket never opens and the UI sits at "reconnecting".
 *
 * The fix is a tiny polyfill injected at the top of the connection factory.
 * Idempotent: a marker comment makes a second run a no-op.
 *
 *   node scripts/patch-pe-polyfill.mjs [--root dist/pure]
 */

import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const args = process.argv.slice(2)
const rootArg = args.indexOf('--root')
const root = rootArg >= 0 ? args[rootArg + 1] : join(process.cwd(), 'dist', 'pure')

const target = join(
  root,
  'runtime',
  'node_modules',
  '@deepseek-ai',
  'dsh-client-connection',
  'lib',
  'client.js',
)

const MARKER = '/* pe-polyfill:v1 */'

const POLYFILL = MARKER + `
;(function () {
  function def(o, k, v) {
    try { Object.defineProperty(o, k, { value: v, writable: true, configurable: true }) } catch (e) { o[k] = v }
  }
  if (typeof AbortSignal !== 'undefined') {
    if (!AbortSignal.any) def(AbortSignal, 'any', function (signals) {
      var c = new AbortController()
      try {
        for (var i = 0; i < signals.length; i++) {
          var s = signals[i]
          if (s.aborted) { c.abort(s.reason); break }
          ;(function (sig) {
            sig.addEventListener('abort', function () { try { c.abort(sig.reason) } catch (e) {} })
          })(s)
        }
      } catch (e) {}
      return c.signal
    })
    if (!AbortSignal.prototype.throwIfAborted) def(AbortSignal.prototype, 'throwIfAborted', function () {
      if (this.aborted) throw this.reason
    })
    if (!AbortSignal.timeout) def(AbortSignal, 'timeout', function (ms) {
      var c = new AbortController()
      setTimeout(function () { try { c.abort(new Error('TimeoutError')) } catch (e) {} }, ms)
      return c.signal
    })
  }
  if (!Array.prototype.at) def(Array.prototype, 'at', function (i) { i = Math.trunc(i) || 0; if (i < 0) i += this.length; return this[i] })
  if (!String.prototype.at) def(String.prototype, 'at', function (i) { i = Math.trunc(i) || 0; if (i < 0) i += this.length; return this[i] })
  if (!Object.hasOwn) def(Object, 'hasOwn', function (o, k) { return Object.prototype.hasOwnProperty.call(o, k) })
  if (typeof structuredClone !== 'function') def(window, 'structuredClone', function (v) { return JSON.parse(JSON.stringify(v)) })
  if (typeof crypto !== 'undefined' && !crypto.randomUUID) def(crypto, 'randomUUID', function () {
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function (ch) {
      var r = (Math.random() * 16) | 0
      return (ch === 'x' ? r : (r & 0x3) | 0x8).toString(16)
    })
  })
})()
`

if (!existsSync(target)) {
  console.error('[polyfill] target not found: ' + target)
  process.exit(1)
}

const text = readFileSync(target, 'utf8')
if (text.indexOf(MARKER) >= 0) {
  console.log('[polyfill] already patched')
  process.exit(0)
}

const anchor = 'factory: (require) => {'
const at = text.indexOf(anchor)
if (at < 0) {
  console.error('[polyfill] anchor not found in ' + target)
  process.exit(1)
}

const patched = text.slice(0, at + anchor.length) + '\n' + POLYFILL + text.slice(at + anchor.length)
writeFileSync(target, patched)
console.log('[polyfill] patched ' + target + ' (+' + (patched.length - text.length) + ' bytes)')
