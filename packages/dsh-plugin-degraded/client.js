/**
 * dsh-plugin-degraded — Web client half.
 *
 * Hand-written ModuleLoader bundle (same shape as dsh-phone / dsh-feature-toggles):
 * no build step, no import of any Harness Client package. It renders the
 * environment report in Settings and an optional one-line rescue badge.
 *
 * Data comes from the Host route `/api/dsh-rescue/capabilities`; when that route
 * is unreachable the panel degrades to "unavailable" instead of guessing.
 */
window.__ModuleLoader__.load({
  id: 'dsh-plugin-degraded',
  factory: (require) => {
    var module = { exports: {} }
    var exports = module.exports
    Object.defineProperty(exports, Symbol.toStringTag, { value: 'Module' })

    var react = require('react')
    var h = react.createElement
    var useState = react.useState
    var useEffect = react.useEffect

    var ROUTE = '/api/dsh-rescue/capabilities'

    var CARD = {
      border: '1px solid var(--dsw-alias-border-l2)',
      borderRadius: 12,
      padding: 14,
      background: 'var(--dsw-alias-bg-layer-2, transparent)',
      display: 'grid',
      gap: 10,
    }
    var ROW = { display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 16 }
    var MUTED = { opacity: 0.7, fontSize: 12, lineHeight: 1.6 }
    var LABEL = { fontSize: 13, fontWeight: 600 }
    var VALUE = { fontSize: 12, fontFamily: 'ui-monospace, SFMono-Regular, Consolas, monospace' }
    var CHIP = {
      display: 'inline-block',
      border: '1px solid var(--dsw-alias-border-l2)',
      borderRadius: 6,
      padding: '2px 6px',
      margin: '0 6px 6px 0',
      fontSize: 11,
      fontFamily: 'ui-monospace, SFMono-Regular, Consolas, monospace',
    }

    function useCapabilities() {
      var [state, setState] = useState({ loading: true, data: null, error: null })
      useEffect(function () {
        var alive = true
        fetch(ROUTE, { headers: { accept: 'application/json' }, credentials: 'same-origin' })
          .then(function (response) {
            if (!response.ok) throw new Error('HTTP ' + response.status)
            return response.json()
          })
          .then(function (data) {
            if (alive) setState({ loading: false, data: data, error: null })
          })
          .catch(function (error) {
            if (alive) {
              setState({
                loading: false,
                data: null,
                error: String((error && error.message) || error),
              })
            }
          })
        return function () {
          alive = false
        }
      }, [])
      return state
    }

    function badgeStyle(color) {
      return {
        fontSize: 11,
        borderRadius: 999,
        padding: '2px 8px',
        border: '1px solid var(--dsw-alias-border-l2)',
        color: color,
      }
    }

    function CapabilityRow(props) {
      var on = props.enabled === true
      return h(
        'div',
        { style: ROW },
        h('span', { style: LABEL }, props.label),
        h(
          'span',
          { style: { display: 'flex', gap: 8, alignItems: 'baseline' } },
          h('span', { style: MUTED }, props.reason || ''),
          h('span', { style: badgeStyle(on ? '#7fd6a0' : '#e5484d') }, on ? '启用' : '关闭'),
        ),
      )
    }

    function RescuePanel() {
      var state = useCapabilities()

      if (state.loading) {
        return h('div', { style: CARD }, h('span', { style: MUTED, role: 'status' }, '正在读取救援状态…'))
      }

      if (state.error) {
        return h(
          'div',
          { style: CARD },
          h('strong', { style: { fontSize: 15 } }, '救援模式'),
          h('span', { style: MUTED }, '无法读取 /api/dsh-rescue/capabilities：' + state.error),
          h('span', { style: MUTED }, '按 minimal 处理：装饰与重能力不启用。'),
        )
      }

      var data = state.data || {}
      var policy = data.policy || {}
      var caps = data.capabilities || {}
      var effective = policy.effective || {}
      var env = caps.env || {}
      var disabledTools = policy.disabledTools || []
      var notes = policy.notes || []

      var rows = [
        { key: 'shell', label: 'Shell', enabled: effective.shell, reason: (policy.reasons || {}).shell },
        { key: 'terminal', label: '终端', enabled: effective.terminal, reason: (policy.reasons || {}).terminal },
        { key: 'image', label: '图片预览', enabled: effective.image, reason: (policy.reasons || {}).image },
        { key: 'ui', label: 'UI 装饰', enabled: effective.ui, reason: (policy.reasons || {}).ui },
      ]

      return h(
        'div',
        { style: { display: 'grid', gap: 12 } },
        h(
          'div',
          { style: CARD },
          h('strong', { style: { fontSize: 15 } }, '救援模式'),
          h(
            'div',
            { style: MUTED },
            (env.platform || '未知') +
              ' · ' +
              (env.arch || '未知') +
              ' · Node ' +
              (env.node || '未知') +
              ' · WinPE ' +
              (env.isPE ? '是' : '否') +
              ' · DSH_HOME ' +
              (env.dshHomeWritable ? '可写' : '不可写'),
          ),
          h('div', { style: MUTED }, '当前 UI 预设：' + (policy.uiPreset || 'minimal')),
        ),
        h('div', { style: CARD }, rows.map(function (row) {
          return h(CapabilityRow, {
            key: row.key,
            label: row.label,
            enabled: row.enabled,
            reason: row.reason,
          })
        })),
        disabledTools.length > 0
          ? h(
              'div',
              { style: CARD },
              h('strong', { style: LABEL }, '被禁用的工具'),
              h(
                'div',
                { style: { display: 'flex', flexWrap: 'wrap' } },
                disabledTools.map(function (name) {
                  return h('span', { key: name, style: CHIP }, name)
                }),
              ),
            )
          : null,
        h(
          'div',
          { style: CARD },
          h('strong', { style: LABEL }, '切换 UI 预设'),
          h('div', { style: MUTED }, '命令行：start.cmd --ui full（minimal 为默认）'),
          h('div', { style: MUTED }, '或修改 config.json 的 profile.ui 后重跑 node scripts/setup.mjs'),
          h('div', { style: MUTED }, '切换后需要重启 web 进程，不需要重装依赖。'),
        ),
        notes.length > 0
          ? h(
              'div',
              { style: CARD },
              h('strong', { style: LABEL }, '提示'),
              notes.map(function (note, index) {
                return h('div', { key: index, style: MUTED }, '· ' + note)
              }),
            )
          : null,
      )
    }

    /** One-line badge, only when something is actually degraded. */
    function RescueBadge() {
      var state = useCapabilities()
      if (state.loading || state.error || !state.data) return null
      var policy = state.data.policy || {}
      var env = (state.data.capabilities || {}).env || {}
      var disabled = policy.disabledTools || []
      if (disabled.length === 0 && !env.isPE) return null

      var text = env.isPE ? '救援模式 · WinPE' : '救援模式 · 已降级 ' + disabled.length + ' 项'

      return h(
        'div',
        {
          'aria-label': 'dsh-rescue status',
          style: {
            position: 'fixed',
            right: 12,
            bottom: 12,
            zIndex: 60,
            pointerEvents: 'none',
            fontSize: 11,
            lineHeight: 1.4,
            padding: '3px 8px',
            borderRadius: 999,
            border: '1px solid var(--dsw-alias-border-l2)',
            background: 'var(--dsw-alias-bg-layer-2, rgba(0,0,0,0.35))',
            color: 'var(--dsw-alias-label-secondary, currentColor)',
            opacity: 0.85,
          },
        },
        text,
      )
    }

    function apply(ctx) {
      ctx.slots.inject('settings.section', function () {
        return ctx.slots.register(
          {
            name: 'settings.section',
            id: 'dsh-rescue',
            order: 8.5,
            label: function () {
              return '救援模式'
            },
          },
          RescuePanel,
        )
      })

      ctx.slots.inject('shell.overlay', function () {
        return ctx.slots.register(
          {
            name: 'shell.overlay',
            id: 'dsh-rescue-badge',
            order: 90,
          },
          RescueBadge,
        )
      })
    }

    exports.apply = apply
    exports.inject = ['slots']
    return module.exports
  },
})
