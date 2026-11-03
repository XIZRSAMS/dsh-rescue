/**
 * dsh-plugin-degraded — Host half.
 *
 * Responsibilities:
 *   1. probe  (lib/probe.js)  — pure, injectable facts
 *   2. decide (lib/policy.js) — pure, three-state switches + preset
 *   3. side effects (this file) — provide a service, hide unavailable tools,
 *      render a prompt section, expose `/rescue`, serve the browser route
 *
 * Every capability access is optional: the plugin must stay active in a profile
 * that has no web server, no PTY backend, or no command registry.
 */

import { lstatSync, mkdirSync, writeFileSync, unlinkSync, accessSync, constants as fsConstants } from 'node:fs'
import { join } from 'node:path'

import { probeCapabilities } from './lib/probe.js'
import { decide, intersectTools, normalizeUiSwitch } from './lib/policy.js'
import { renderJson, renderReport } from './lib/report.js'
import { normalizeConfig } from './lib/config.js'

export const name = 'dsh-plugin-degraded'

/** Reported version; setup.mjs exports it so the plugin keeps no package.json read. */
const RESCUE_VERSION = String(process.env.DSH_RESCUE_VERSION || '0.1.0')
const ROUTE_PATH = '/api/dsh-rescue/capabilities'
const LOOPBACK_ROUTE = '/dsh-rescue/capabilities.json'
const PROMPT_SECTION = 'rescue-environment'
const COMMAND_NAME = 'rescue'

/* ── small helpers ──────────────────────────────────────────────────────── */

/** Read an optional service without throwing when it is absent. */
function optional(scope, service) {
  if (!scope) return undefined
  try {
    if (typeof scope.get === 'function') {
      const value = scope.get(service)
      if (value !== undefined && value !== null) return value
    }
  } catch {
    /* absent service */
  }
  try {
    return scope[service]
  } catch {
    return undefined
  }
}

function fileExists(path) {
  try {
    const stat = lstatSync(path)
    return stat.isFile() || stat.isSymbolicLink()
  } catch {
    return false
  }
}

function dirExists(path) {
  try {
    return lstatSync(path).isDirectory()
  } catch {
    return false
  }
}

/** Real write probe: create the directory when missing, then write and remove a marker. */
function canWrite(dir) {
  if (!dir) return false
  try {
    mkdirSync(dir, { recursive: true })
  } catch {
    return false
  }
  const marker = join(dir, '.dsh-rescue-write-probe')
  try {
    accessSync(dir, fsConstants.W_OK)
    writeFileSync(marker, 'ok', { encoding: 'utf8' })
    unlinkSync(marker)
    return true
  } catch {
    try {
      unlinkSync(marker)
    } catch {
      /* nothing to clean */
    }
    return false
  }
}

/** Read the CLI/environment preset override, the highest priority layer. */
function readOverride() {
  const raw = normalizeUiSwitch(process.env.DSH_RESCUE_UI, 'auto')
  return raw === 'auto' ? {} : { uiPreset: raw }
}

function isLoopback(req) {
  try {
    const address = req.socket && req.socket.remoteAddress
    return address === '127.0.0.1' || address === '::1' || address === '::ffff:127.0.0.1'
  } catch {
    return false
  }
}

/* ── plugin ─────────────────────────────────────────────────────────────── */

/**
 * @param {import('@deepseek-ai/cordis').Context} ctx
 * @param {unknown} rawConfig
 */
export function apply(ctx, rawConfig) {
  const config = normalizeConfig(rawConfig)
  const override = readOverride()
  const log = (...args) => {
    try {
      console.log('[dsh-rescue]', ...args)
    } catch {
      /* logging is best effort */
    }
  }

  if (config.warnings.length > 0) {
    for (const warning of config.warnings) log(`config: ${warning}`)
  }

  const profileName = String(process.env.DSH_RESCUE_PROFILE || process.env.DSH_PROFILE || '')

  /** Probe once now; `refresh()` re-probes after optional services appear. */
  const probe = () => {
    const terminals = optional(ctx, 'terminals')
    return probeCapabilities({
      platform: process.platform,
      env: process.env,
      pathExists: fileExists,
      dirExists,
      canWrite,
      terminalBackends: () => {
        try {
          return terminals && typeof terminals.listBackends === 'function' ? terminals.listBackends() : []
        } catch {
          return []
        }
      },
      // A session preset registers its PTY backend in an isolated realm, so the
      // Host-side backend list can be empty while terminal tools work.
      hasTerminalService: () => terminals !== undefined && terminals !== null,
    })
  }

  const state = {
    capabilities: probe(),
    policy: undefined,
    generatedAt: Date.now(),
  }
  state.policy = decide(state.capabilities, config, override)

  const meta = () => ({
    rescueVersion: RESCUE_VERSION,
    profile: profileName,
    generatedAt: state.generatedAt,
  })

  const snapshot = () => ({ capabilities: state.capabilities, policy: state.policy, meta: meta() })

  const refresh = () => {
    const previousPreset = state.policy && state.policy.uiPreset
    state.capabilities = probe()
    state.policy = decide(state.capabilities, config, override)
    state.generatedAt = Date.now()
    if (previousPreset !== state.policy.uiPreset) {
      log(`ui.preset: ${previousPreset} → ${state.policy.uiPreset}`)
    }
    return snapshot()
  }

  // Expose the snapshot for patches (`!!js ctx.get('rescue')`) and for the browser half.
  try {
    ctx.provide('rescue', {
      get capabilities() {
        return state.capabilities
      },
      get policy() {
        return state.policy
      },
      report: () => renderReport(snapshot()),
      json: () => renderJson(snapshot()),
      refresh,
    })
  } catch (error) {
    log(`could not provide the 'rescue' service: ${String(error && error.message ? error.message : error)}`)
  }

  // ── prompt section ─────────────────────────────────────────────────────
  // ── optional-service registrations ─────────────────────────────────────
  // Register through `ctx.inject(deps, cb)`: webServer / systemPrompt / commands
  // are frequently mounted AFTER this plugin, so reading them directly in
  // `apply` yields undefined and nothing registers (observed: route 404 and a
  // missing /rescue command). The callback runs once every dep exists, and its
  // registrations are owned by that injection fiber.
  const register = (deps, callback) => {
    try {
      if (typeof ctx.inject === 'function') {
        ctx.inject(deps, (sub) => {
          log(`services ready: ${deps.join(',')}`)
          callback(sub)
        })
        return
      }
      const scope = {}
      for (const dep of deps) {
        const value = optional(ctx, dep)
        if (!value) {
          log(`service '${dep}' missing; registration skipped`)
          return
        }
        scope[dep] = value
      }
      callback({ ...scope, effect: (fn) => ctx.effect(fn) })
    } catch (error) {
      log(`inject ${deps.join(',')} failed: ${String(error && error.message ? error.message : error)}`)
    }
  }

  // ── prompt section ─────────────────────────────────────────────────────
  if (config.report.promptSection) {
    register(['systemPrompt'], (sub) => {
      sub.effect(() =>
        sub.systemPrompt.section({
          name: PROMPT_SECTION,
          order: 900,
          text: () => {
            const report = renderReport(snapshot())
            return [
              '[dsh-rescue] 当前运行在救援/降级模式，以下是本机的能力结论（自动生成）。',
              '被关闭的能力不要尝试使用，也不要建议用户启用它们；用户问起时直接引用本段。',
              '',
              report.text,
            ].join('\n')
          },
        }),
      )
    })
  }

  // ── /rescue command ────────────────────────────────────────────────────
  if (config.report.command) {
    register(['commands'], (sub) => {
      sub.effect(() =>
        sub.commands.register({
          name: COMMAND_NAME,
          description: '显示 dsh-rescue 环境报告：能力探测结论、被关闭的能力与原因',
          handler: (invocation) => {
            const argument = String((invocation && invocation.rawInput) || '')
              .trim()
              .replace(/^\/?rescue\s*/iu, '')
              .toLowerCase()

            if (argument === 'json') {
              return {
                kind: 'success',
                text: '```json\n' + JSON.stringify(renderJson(snapshot()), null, 2) + '\n```',
              }
            }
            if (argument === 'refresh') {
              refresh()
              return { kind: 'success', text: renderReport(snapshot()).text }
            }
            if (argument === 'tools') {
              const disabled = (state.policy && state.policy.disabledTools) || []
              return {
                kind: 'success',
                text: disabled.length > 0 ? `被禁用工具：${disabled.join(', ')}` : '没有被禁用的工具',
              }
            }
            return { kind: 'success', text: renderReport(snapshot()).text }
          },
        }),
      )
    })
  }

  // ── browser route ──────────────────────────────────────────────────────
  // `/api/...` sits behind the web trust fence (token/cookie), which is exactly
  // what the browser half needs. The second, loopback-only route exists for
  // `verify.mjs --boot` and curl-style diagnosis, which have no session cookie.
  register(['webServer'], (sub) => {
    const handlerFor = (requireLoopback) => (req, res) => {
      if (req.method !== 'GET' && req.method !== 'HEAD') {
        res.writeHead(405, { allow: 'GET, HEAD' })
        res.end()
        return
      }
      const loopback = isLoopback(req)
      if ((requireLoopback || !config.server.allowRemote) && !loopback) {
        res.writeHead(403, { 'content-type': 'text/plain; charset=utf-8' })
        res.end('forbidden')
        return
      }
      const body = JSON.stringify(renderJson(snapshot()))
      res.writeHead(200, {
        'content-type': 'application/json; charset=utf-8',
        'cache-control': 'no-store',
        'x-content-type-options': 'nosniff',
      })
      res.end(req.method === 'HEAD' ? undefined : body)
    }

    sub.effect(() => sub.webServer.register({ kind: 'exact', path: ROUTE_PATH, handler: handlerFor(false) }))
    sub.effect(() => sub.webServer.register({ kind: 'exact', path: LOOPBACK_ROUTE, handler: handlerFor(true) }))
  })

  // ── per-agent tool restriction ─────────────────────────────────────────
  if (typeof ctx.on === 'function') {
    const restrictions = new Map()

    const applyTo = (agent) => {
      try {
        if (!agent || !agent.ctx) return
        const agentTools = optional(agent.ctx, 'tools')
        if (!agentTools || typeof agentTools.restrict !== 'function') return

        const registry = optional(ctx, 'tools')
        const visible =
          registry && typeof registry.schemas === 'function'
            ? registry.schemas(agent).map((schema) => (schema && schema.name) || '')
            : []
        const deny = intersectTools((state.policy && state.policy.disabledTools) || [], visible)
        if (deny.length === 0) return

        const dispose = agentTools.restrict({ deny })
        const previous = restrictions.get(agent.id)
        if (previous) {
          try {
            previous()
          } catch {
            /* ignore */
          }
        }
        restrictions.set(agent.id, dispose)
      } catch (error) {
        log(`tool restriction skipped: ${String(error && error.message ? error.message : error)}`)
      }
    }

    ctx.effect(() => {
      const offCreated = ctx.on('agent/created', (payload) => {
        const agent = payload && payload.agent
        // Terminals are mounted before any agent can exist, so re-probe here:
        // the initial probe may have run before the PTY backend was registered.
        refresh()
        applyTo(agent)
      })

      const offDisposed = ctx.on('agent/disposed', (payload) => {
        const id = payload && payload.agent && payload.agent.id
        if (!id) return
        const dispose = restrictions.get(id)
        if (dispose) {
          try {
            dispose()
          } catch {
            /* ignore */
          }
          restrictions.delete(id)
        }
      })

      const offReload =
        typeof ctx.on === 'function'
          ? ctx.on('app-boot/config-reload', () => {
              refresh()
            })
          : undefined

      return () => {
        try {
          offCreated && offCreated()
        } catch {
          /* ignore */
        }
        try {
          offDisposed && offDisposed()
        } catch {
          /* ignore */
        }
        try {
          offReload && offReload()
        } catch {
          /* ignore */
        }
        for (const dispose of restrictions.values()) {
          try {
            dispose()
          } catch {
            /* ignore */
          }
        }
        restrictions.clear()
      }
    })
  }

  log(
    `probed: shell=${state.capabilities.shell.mode} pty=${state.capabilities.terminal.backends.length} ` +
      `pe=${state.capabilities.env.isPE} ui=${state.policy.uiPreset} denied=${state.policy.disabledTools.length}`,
  )
}
