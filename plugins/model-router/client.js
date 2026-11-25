window.__ModuleLoader__.load({
  id: '@dsh-plugins/model-router',
  factory(require) {
    const React = require('react')
    const h = React.createElement
    const { useCallback, useEffect, useRef, useState } = React

    const styles = `
      .mr-dashboard{height:100%;min-height:100%;max-height:100vh;overflow-y:auto;background:#0d1117;color:#e6edf3;font:14px/1.45 -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;padding:28px;box-sizing:border-box}
      .mr-dashboard *{box-sizing:border-box}.mr-header{display:flex;justify-content:space-between;gap:20px;align-items:flex-start;margin-bottom:24px}
      .mr-header h1{margin:0 0 5px;font-size:24px;font-weight:650}.mr-header p,.mr-muted{margin:0;color:#8b949e}.mr-actions{display:flex;gap:8px}
      .mr-button{border:1px solid #30363d;background:#21262d;color:#e6edf3;border-radius:6px;padding:7px 12px;cursor:pointer}.mr-button:disabled{opacity:.5;cursor:default}
      .mr-grid{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:12px;margin-bottom:16px}.mr-card,.mr-panel{background:#161b22;border:1px solid #30363d;border-radius:10px}
      .mr-card{padding:16px}.mr-label{color:#8b949e;font-size:12px;margin-bottom:7px}.mr-value{font-size:25px;font-weight:650;letter-spacing:-.02em}.mr-detail{color:#8b949e;font-size:12px;margin-top:4px}
      .mr-layout{display:grid;grid-template-columns:1.65fr 1fr;gap:16px;margin-bottom:16px}.mr-panel{padding:18px;margin-bottom:16px}.mr-layout .mr-panel{margin-bottom:0}
      .mr-panel h2{margin:0 0 16px;font-size:15px;font-weight:650}.mr-legend{display:flex;gap:14px;color:#8b949e;font-size:12px;margin-bottom:18px}
      .mr-dot{display:inline-block;width:7px;height:7px;border-radius:50%;margin-right:5px;background:#58a6ff}.mr-dot.quota{background:#bc8cff}
      .mr-chart{height:190px;display:flex;align-items:flex-end;gap:12px;border-bottom:1px solid #30363d;padding:10px 4px 24px;margin-bottom:10px}
      .mr-bar-group{flex:1;height:100%;display:flex;align-items:flex-end;justify-content:center;gap:4px;position:relative}.mr-bar{width:16px;min-height:2px;border-radius:3px 3px 0 0;background:#58a6ff}.mr-bar.quota{background:#bc8cff}
      .mr-bar-label{position:absolute;bottom:-22px;color:#8b949e;font-size:11px}.mr-health{display:grid;grid-template-columns:repeat(3,1fr);gap:8px;margin-bottom:16px}
      .mr-health-count{border:1px solid #30363d;border-radius:7px;padding:10px;text-align:center}.mr-health-count strong{display:block;font-size:20px}.mr-green{color:#3fb950}.mr-yellow{color:#d29922}.mr-red{color:#f85149}
      .mr-probe{border-top:1px solid #30363d;padding-top:14px;margin-top:16px}.mr-probe strong{display:block;margin-bottom:3px}.mr-probe p{color:#8b949e;margin:0}
      .mr-table-wrap{overflow-x:auto}.mr-table{width:100%;border-collapse:collapse}.mr-table th{color:#8b949e;font-size:11px;text-transform:uppercase;letter-spacing:.04em;text-align:left;padding:0 10px 10px}
      .mr-table td{padding:13px 10px;border-top:1px solid #21262d;white-space:nowrap}.mr-table td:first-child{white-space:normal;min-width:200px}.mr-route{font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:12px}
      .mr-badge{display:inline-flex;align-items:center;border-radius:999px;padding:3px 8px;font-size:11px;background:#21262d;color:#8b949e}.mr-badge.healthy{color:#3fb950;background:#3fb95018}.mr-badge.degraded{color:#d29922;background:#d2992218}.mr-badge.unhealthy{color:#f85149;background:#f8514918}
      .mr-footer{margin-top:14px;color:#8b949e;font-size:12px}.mr-state{padding:48px 24px;text-align:center;color:#8b949e}.mr-state strong{display:block;color:#e6edf3;font-size:16px;margin-bottom:8px}.mr-error{color:#f85149;margin-bottom:12px}
      @media(max-width:850px){.mr-dashboard{padding:18px}.mr-grid{grid-template-columns:repeat(2,1fr)}.mr-layout{grid-template-columns:1fr}.mr-header{flex-direction:column}.mr-actions{width:100%}.mr-actions button{flex:1}}
      @media(max-width:430px){.mr-grid{grid-template-columns:1fr}.mr-card{padding:13px}.mr-value{font-size:22px}.mr-panel{padding:14px}}
    `

    const sum = (values) => values.reduce((total, value) => total + BigInt(value || 0), 0n)
    const money = (micro) => {
      const value = BigInt(micro || 0)
      const whole = value / 1000000n
      const fraction = (value % 1000000n).toString().padStart(6, '0')
      return `$${whole.toLocaleString()}.${fraction.slice(0, 4)}`
    }
    const number = (value) => Number(value || 0).toLocaleString()
    const quota = (milliUnits) => {
      const value = BigInt(milliUnits || 0)
      const whole = value / 1000n
      const fraction = (value % 1000n).toString().padStart(3, '0').replace(/0+$/u, '')
      return fraction ? `${whole.toLocaleString()}.${fraction}` : whole.toLocaleString()
    }
    const percent = (basisPoints) => basisPoints === null || basisPoints === undefined ? 'n/a' : `${(basisPoints / 100).toFixed(1)}%`
    const healthLabel = (status) => status === 'unknown' ? 'Not observed' : status[0].toUpperCase() + status.slice(1)

    function aggregateDays(routes) {
      const days = new Map()
      for (const route of routes) {
        for (const bucket of route.daily || []) {
          const current = days.get(bucket.date) || { date: bucket.date, cash: 0n, quota: 0n }
          if (route.billing === 'pay-as-you-go') current.cash += BigInt(bucket.tokens.output)
          if (route.billing === 'subscription') current.quota += BigInt(bucket.tokens.output)
          days.set(bucket.date, current)
        }
      }
      return [...days.values()].sort((a, b) => a.date.localeCompare(b.date)).slice(-7)
    }

    function Chart({ routes }) {
      const days = aggregateDays(routes)
      if (days.length === 0) return h('div', { className: 'mr-state' }, 'Daily history starts with newly measured requests.')
      const maximum = days.reduce((max, day) => {
        const value = day.cash + day.quota
        return value > max ? value : max
      }, 0n)
      const height = (value) => maximum === 0n ? 2 : Math.max(2, Number(value * 100n / maximum))
      return h(React.Fragment, null,
        h('div', { className: 'mr-legend' },
          h('span', null, h('i', { className: 'mr-dot' }), 'Pay-as-you-go output tokens'),
          h('span', null, h('i', { className: 'mr-dot quota' }), 'Subscription output tokens')),
        h('div', { className: 'mr-chart', 'aria-label': 'Recent daily output token usage' }, days.map(day =>
          h('div', { className: 'mr-bar-group', key: day.date, title: `${day.date}: ${day.cash + day.quota} output tokens` },
            h('i', { className: 'mr-bar', style: { height: `${height(day.cash)}%` } }),
            h('i', { className: 'mr-bar quota', style: { height: `${height(day.quota)}%` } }),
            h('span', { className: 'mr-bar-label' }, day.date.slice(5))))))
    }

    function Dashboard({ load, setRouting }) {
      const [report, setReport] = useState(null)
      const [error, setError] = useState(null)
      const [loading, setLoading] = useState(true)
      const controller = useRef(null)
      const refresh = useCallback(async () => {
        controller.current?.abort()
        const next = new AbortController()
        controller.current = next
        setLoading(true)
        setError(null)
        try {
          const value = await load(next.signal)
          if (!next.signal.aborted) setReport(value)
        } catch (cause) {
          if (!next.signal.aborted) setError(cause instanceof Error ? cause.message : 'Report unavailable')
        } finally {
          if (!next.signal.aborted) setLoading(false)
        }
      }, [load])
      useEffect(() => {
        refresh()
        return () => controller.current?.abort()
      }, [refresh])

      if (loading && !report) return h('main', { className: 'mr-dashboard' }, h('style', null, styles), h('div', { className: 'mr-state' }, 'Loading model usage and route health…'))
      if (error && !report) return h('main', { className: 'mr-dashboard' }, h('style', null, styles),
        h('div', { className: 'mr-state' }, h('strong', null, 'Dashboard unavailable'), h('div', { className: 'mr-error' }, error), h('button', { className: 'mr-button', onClick: refresh }, 'Retry')))
      if (!report) return null

      const requests = report.routes.reduce((total, route) => total + route.requests, 0)
      const completed = report.routes.reduce((total, route) => total + route.completed, 0)
      const ratedGood = report.routes.reduce((total, route) => total + route.ratedGood, 0)
      const ratedBad = report.routes.reduce((total, route) => total + route.ratedBad, 0)
      const rated = ratedGood + ratedBad
      const quotaUsed = sum(report.subscriptions.map(item => item.quotaMilliUnits))
      const quotaLimit = sum(report.subscriptions.map(item => item.quotaLimitMilliUnits))
      const quotaPercent = quotaLimit === 0n ? null : Number(quotaUsed * 1000n / quotaLimit) / 10
      const toggleRouting = async () => {
        try {
          await setRouting(!report.routingEnabled)
          await refresh()
        } catch (cause) {
          setError(cause instanceof Error ? cause.message : 'Routing update failed')
        }
      }

      return h('main', { className: 'mr-dashboard', 'aria-label': 'Model router dashboard' },
        h('style', null, styles),
        h('header', { className: 'mr-header' },
          h('div', null, h('h1', null, 'Model router'), h('p', null, `Usage efficiency and model route health · ${report.strategy} strategy · automatic routing ${report.routingEnabled ? 'on' : 'off'}`)),
          h('div', { className: 'mr-actions' },
            h('button', { className: 'mr-button', onClick: toggleRouting }, report.routingEnabled ? 'Pause routing' : 'Resume routing'),
            h('button', { className: 'mr-button', onClick: refresh, disabled: loading }, loading ? 'Refreshing…' : 'Refresh'))),
        error ? h('div', { className: 'mr-error' }, error) : null,
        h('section', { className: 'mr-grid', 'aria-label': 'Usage summary' },
          h('div', { className: 'mr-card' }, h('div', { className: 'mr-label' }, 'REQUESTS · ALL TIME'), h('div', { className: 'mr-value' }, requests.toLocaleString()), h('div', { className: 'mr-detail' }, `${requests ? (completed * 100 / requests).toFixed(1) : '0.0'}% completed`)),
          h('div', { className: 'mr-card' }, h('div', { className: 'mr-label' }, 'CASH SPEND'), h('div', { className: 'mr-value' }, money(report.totals.cashMicroUsd)), h('div', { className: 'mr-detail' }, `${requests ? money((BigInt(report.totals.cashMicroUsd) / BigInt(requests)).toString()) : '$0.0000'} per request`)),
          h('div', { className: 'mr-card' }, h('div', { className: 'mr-label' }, 'SUBSCRIPTION QUOTA'), h('div', { className: 'mr-value' }, quotaPercent === null ? 'n/a' : `${quotaPercent.toFixed(1)}%`), h('div', { className: 'mr-detail' }, quotaLimit === 0n ? 'No configured limit' : 'Current configured windows')),
          h('div', { className: 'mr-card' }, h('div', { className: 'mr-label' }, 'USER-RATED SUCCESS'), h('div', { className: 'mr-value' }, rated ? `${(ratedGood * 100 / rated).toFixed(1)}%` : 'n/a'), h('div', { className: 'mr-detail' }, rated ? `${ratedGood} of ${rated} rated requests` : 'No rated requests'))),
        h('section', { className: 'mr-layout' },
          h('div', { className: 'mr-panel' }, h('h2', null, 'Usage and estimated value'), h(Chart, { routes: report.routes })),
          h('div', { className: 'mr-panel' }, h('h2', null, 'Route health'),
            h('div', { className: 'mr-health' },
              h('div', { className: 'mr-health-count' }, h('strong', { className: 'mr-green' }, report.healthSummary.healthy), h('span', { className: 'mr-muted' }, 'Healthy')),
              h('div', { className: 'mr-health-count' }, h('strong', { className: 'mr-yellow' }, report.healthSummary.degraded), h('span', { className: 'mr-muted' }, 'Degraded')),
              h('div', { className: 'mr-health-count' }, h('strong', { className: 'mr-red' }, report.healthSummary.unhealthy), h('span', { className: 'mr-muted' }, 'Unavailable'))),
            h('p', { className: 'mr-muted' }, 'Health combines validation, request outcomes, latency, and optional probes. Repeated failures temporarily exclude a route.'),
            h('div', { className: 'mr-probe' }, h('strong', null, `Active probes: ${report.activeProbes.length ? `${report.activeProbes.length} routes` : 'off'}`), h('p', null, report.activeProbes.length ? report.activeProbes.join(', ') : 'No extra model requests or spend. Enable per route in configuration.')))),
        h('section', { className: 'mr-panel mr-table-wrap' }, h('h2', null, 'Models'), report.routes.length === 0
          ? h('div', { className: 'mr-state' }, h('strong', null, 'No model requests measured'), 'Usage appears after the next conversation request.')
          : h('table', { className: 'mr-table' },
            h('thead', null, h('tr', null, ['Route', 'Health', 'Requests', 'Avg latency', 'Cash / quota', 'Output efficiency', 'Rated success'].map(label => h('th', { key: label }, label)))),
            h('tbody', null, report.routes.map(route => {
              const label = `${route.provider}/${route.model}`
              const cashOrQuota = route.billing === 'subscription' ? `${quota(route.quotaMilliUnits)} units` : money(route.cashMicroUsd)
              const efficiency = route.billing === 'subscription'
                ? `${route.outputTokensPerQuotaUnit || 'n/a'} tok/unit`
                : `${route.cashMicroUsdPer1kOutputTokens === null ? 'n/a' : money(route.cashMicroUsdPer1kOutputTokens)} / 1k tok`
              return h('tr', { key: label },
                h('td', null, h('div', { className: 'mr-route' }, label), h('div', { className: 'mr-muted' }, `${route.billing}${route.health.lastProbeAt ? ' · probed' : ''}`)),
                h('td', null, h('span', { className: `mr-badge ${route.health.status}`, title: route.health.lastFailureCode || undefined }, `● ${healthLabel(route.health.status)}`)),
                h('td', null, number(route.requests)),
                h('td', null, `${number(route.averageLatencyMs)} ms`),
                h('td', null, cashOrQuota),
                h('td', null, efficiency),
                h('td', null, percent(route.ratedSuccessBasisPoints)))
            }))),
          h('div', { className: 'mr-footer' }, `Last refreshed ${new Date(report.generatedAt).toLocaleTimeString()} · No request content or credentials are shown.${report.persistenceError ? ` · ${report.persistenceError}` : ''}`)))
    }

    function PanelIcon() {
      return h('svg', { viewBox: '0 0 16 16', width: 16, height: 16, 'aria-hidden': true },
        h('path', { d: 'M2 13V8m4 5V3m4 10V6m4 7V1', fill: 'none', stroke: 'currentColor', strokeWidth: 1.5 }))
    }

    return {
      inject: ['slots', 'connection', 'locale'],
      apply(ctx) {
        ctx.effect(() => ctx.locale.register('modelRouter', { en: { panel: 'Model routes' } }))
        const t = ctx.locale.bind('modelRouter')
        const load = async signal => {
          const response = await fetch('/api/model-router/report', {
            method: 'POST', headers: { 'content-type': 'application/json' }, body: 'null', signal,
          })
          const value = await response.json()
          if (!response.ok) throw new Error(value.error || 'Report unavailable')
          return value
        }
        const setRouting = async enabled => {
          const response = await fetch('/api/model-router/set-routing', {
            method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ enabled }),
          })
          const value = await response.json()
          if (!response.ok) throw new Error(value.error || 'Routing update failed')
        }
        ctx.slots.inject('main', () => ctx.slots.register({
          name: 'main', key: 'model-router', locale: 'modelRouter', inject: () => ({ load, setRouting }),
        }, Dashboard))
        ctx.slots.inject('sidebar.panellist', () => ctx.slots.register({
          name: 'sidebar.panellist', id: 'model-router', order: 20, label: () => t('panel'), locale: 'modelRouter',
        }, PanelIcon))
      },
    }
  },
})
