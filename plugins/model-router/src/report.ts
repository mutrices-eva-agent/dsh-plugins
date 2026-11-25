import type { Config } from './config.js'
import { emptyRouteStats, type DailyBucket, type MetricsState, type RouteHealth, type RouteStats } from './metrics.js'
import { currentWindowStart } from './routing.js'
import {
  NANO_QUOTA_PER_MILLI_UNIT,
  NANO_QUOTA_PER_UNIT,
  PICO_USD_PER_MICRO_USD,
  ratioBasisPoints,
  routeKey,
  routeLabel,
} from './usage.js'

export interface RouteReport {
  provider: string
  model: string
  billing: 'pay-as-you-go' | 'subscription' | 'unconfigured'
  requests: number
  completed: number
  failed: number
  aborted: number
  truncated: number
  tokens: RouteStats['tokens']
  cashMicroUsd: string
  cashPicoUsd: string
  equivalentMicroUsd: string | null
  quotaMilliUnits: string
  quotaNanoUnits: string
  averageLatencyMs: number
  outputTokensPerSecond: string | null
  cashMicroUsdPer1kOutputTokens: string | null
  cashPicoUsdPer1kOutputTokens: string | null
  outputTokensPerQuotaUnit: string | null
  ratedSuccessBasisPoints: number | null
  ratedGood: number
  ratedBad: number
  health: RouteHealth
  daily: ({ date: string } & DailyBucket)[]
}

export interface UsageReport {
  routes: RouteReport[]
  subscriptions: {
    id: string
    windowStart: string
    quotaMilliUnits: string
    quotaNanoUnits: string
    quotaLimitMilliUnits: string
    quotaLimitNanoUnits: string
    remainingQuotaMilliUnits: string
    remainingQuotaNanoUnits: string
    utilizationBasisPoints: number | null
    windowCostMicroUsd: string | null
  }[]
  totals: {
    cashMicroUsd: string
    cashPicoUsd: string
    quotaMilliUnits: string
    quotaNanoUnits: string
  }
  healthSummary: Record<RouteHealth['status'], number>
  persistenceError?: string
}

function divide(numerator: bigint, denominator: bigint): string | null {
  return denominator === 0n ? null : (numerator / denominator).toString()
}

function routeReport(key: string, stats: RouteStats, state: MetricsState, config: Config): RouteReport {
  const [provider = '', model = ''] = key.split('\0')
  const configured = config.models.find(item => routeKey(item.provider, item.model) === key)
  const requests = BigInt(stats.requests)
  const output = BigInt(stats.tokens.output)
  const cashPicoUsd = BigInt(stats.cashPicoUsd)
  const quotaNanoUnits = BigInt(stats.quotaNanoUnits)
  const latency = BigInt(stats.latencyMs)
  const equivalentMicroUsd = BigInt(stats.equivalentNumerator)
    / (BigInt(stats.equivalentDenominator) * PICO_USD_PER_MICRO_USD)
  return {
    provider,
    model: model || (provider === '' ? key : ''),
    billing: configured?.billing.kind ?? 'unconfigured',
    requests: stats.requests,
    completed: stats.completed,
    failed: stats.failed,
    aborted: stats.aborted,
    truncated: stats.truncated,
    tokens: { ...stats.tokens },
    cashMicroUsd: (cashPicoUsd / PICO_USD_PER_MICRO_USD).toString(),
    cashPicoUsd: stats.cashPicoUsd,
    equivalentMicroUsd: stats.equivalentSamples > 0 ? equivalentMicroUsd.toString() : null,
    quotaMilliUnits: (quotaNanoUnits / NANO_QUOTA_PER_MILLI_UNIT).toString(),
    quotaNanoUnits: stats.quotaNanoUnits,
    averageLatencyMs: stats.requests === 0 ? 0 : Number(latency / requests),
    outputTokensPerSecond: divide(output * 1000n, latency),
    cashMicroUsdPer1kOutputTokens: divide(cashPicoUsd * 1000n, output * PICO_USD_PER_MICRO_USD),
    cashPicoUsdPer1kOutputTokens: divide(cashPicoUsd * 1000n, output),
    outputTokensPerQuotaUnit: divide(output * NANO_QUOTA_PER_UNIT, quotaNanoUnits),
    ratedSuccessBasisPoints: ratioBasisPoints(BigInt(stats.ratedGood), BigInt(stats.ratedGood + stats.ratedBad)),
    ratedGood: stats.ratedGood,
    ratedBad: stats.ratedBad,
    health: { ...(state.health[key] ?? { status: 'unknown', consecutiveFailures: 0 }) },
    daily: Object.entries(state.daily[key] ?? {}).sort(([left], [right]) => left.localeCompare(right))
      .map(([date, bucket]) => ({ date, ...bucket, tokens: { ...bucket.tokens } })),
  }
}

export function createUsageReport(
  state: MetricsState,
  config: Config,
  now: Date,
  persistenceError?: string,
): UsageReport {
  const routeKeys = new Set([
    ...Object.keys(state.routes),
    ...Object.keys(state.health),
    ...config.models.map(model => routeKey(model.provider, model.model)),
  ])
  const routes = [...routeKeys].map(key => routeReport(key, state.routes[key] ?? emptyRouteStats(), state, config))
  routes.sort((left, right) => routeLabel(left.provider, left.model).localeCompare(routeLabel(right.provider, right.model)))
  const subscriptions = config.subscriptions.map(subscription => {
    const windowStart = currentWindowStart(subscription, now)
    const stored = state.subscriptionWindows[subscription.id]?.[windowStart]
    const used = stored === undefined ? 0n : BigInt(stored.quotaNanoUnits)
    const limit = BigInt(subscription.quotaLimitMilliUnits) * NANO_QUOTA_PER_MILLI_UNIT
    return {
      id: subscription.id,
      windowStart,
      quotaMilliUnits: (used / NANO_QUOTA_PER_MILLI_UNIT).toString(),
      quotaNanoUnits: used.toString(),
      quotaLimitMilliUnits: (limit / NANO_QUOTA_PER_MILLI_UNIT).toString(),
      quotaLimitNanoUnits: limit.toString(),
      remainingQuotaMilliUnits: ((limit > used ? limit - used : 0n) / NANO_QUOTA_PER_MILLI_UNIT).toString(),
      remainingQuotaNanoUnits: (limit > used ? limit - used : 0n).toString(),
      utilizationBasisPoints: ratioBasisPoints(used, limit),
      windowCostMicroUsd: subscription.windowCostMicroUsd?.toString() ?? null,
    }
  })
  const totalCashPicoUsd = Object.values(state.routes).reduce((total, route) => total + BigInt(route.cashPicoUsd), 0n)
  const totalQuotaNanoUnits = Object.values(state.routes).reduce((total, route) => total + BigInt(route.quotaNanoUnits), 0n)
  const healthSummary = { unknown: 0, healthy: 0, degraded: 0, unhealthy: 0 }
  for (const route of routes) healthSummary[route.health.status] += 1
  return {
    routes,
    subscriptions,
    totals: {
      cashMicroUsd: (totalCashPicoUsd / PICO_USD_PER_MICRO_USD).toString(),
      cashPicoUsd: totalCashPicoUsd.toString(),
      quotaMilliUnits: (totalQuotaNanoUnits / NANO_QUOTA_PER_MILLI_UNIT).toString(),
      quotaNanoUnits: totalQuotaNanoUnits.toString(),
    },
    healthSummary,
    ...(persistenceError === undefined ? {} : { persistenceError }),
  }
}

function money(microUsd: string): string {
  const value = BigInt(microUsd)
  const whole = value / 1_000_000n
  const fraction = (value % 1_000_000n).toString().padStart(6, '0')
  return `$${whole}.${fraction}`
}

function quota(milliUnits: string): string {
  const value = BigInt(milliUnits)
  return `${value / 1000n}.${(value % 1000n).toString().padStart(3, '0')}`
}

function percent(basisPoints: number | null): string {
  return basisPoints === null ? 'n/a' : `${Math.floor(basisPoints / 100)}.${(basisPoints % 100).toString().padStart(2, '0')}%`
}

export function formatUsageReport(report: UsageReport): string {
  if (report.routes.length === 0) return 'No model requests have been measured yet.'
  const lines = ['Model usage (all time):']
  for (const route of report.routes) {
    lines.push(`- ${routeLabel(route.provider, route.model)} [${route.billing}; ${route.health.status}]`)
    lines.push(`  requests ${route.requests}; completed ${route.completed}; failed ${route.failed}; aborted ${route.aborted}; truncated ${route.truncated}`)
    lines.push(`  tokens input ${route.tokens.input}; cache read ${route.tokens.cacheRead}; cache write ${route.tokens.cacheWrite}; output ${route.tokens.output}`)
    lines.push(`  cash ${money(route.cashMicroUsd)}; quota ${quota(route.quotaMilliUnits)}; average latency ${route.averageLatencyMs} ms`)
    if (route.equivalentMicroUsd !== null) lines.push(`  equivalent value ${money(route.equivalentMicroUsd)}`)
    lines.push(`  output/second ${route.outputTokensPerSecond ?? 'n/a'}; $/1k output ${route.cashMicroUsdPer1kOutputTokens === null ? 'n/a' : money(route.cashMicroUsdPer1kOutputTokens)}; output/quota unit ${route.outputTokensPerQuotaUnit ?? 'n/a'}; rated success ${percent(route.ratedSuccessBasisPoints)}`)
  }
  if (report.subscriptions.length > 0) {
    lines.push('Current subscription windows:')
    for (const subscription of report.subscriptions) {
      if (subscription.quotaLimitMilliUnits === '0') {
        lines.push(`- ${subscription.id}: ${quota(subscription.quotaMilliUnits)} units; no configured limit`)
      } else {
        lines.push(`- ${subscription.id}: ${quota(subscription.quotaMilliUnits)} / ${quota(subscription.quotaLimitMilliUnits)} units; remaining ${quota(subscription.remainingQuotaMilliUnits)}; used ${percent(subscription.utilizationBasisPoints)}`)
      }
    }
  }
  lines.push(`Total cash ${money(report.totals.cashMicroUsd)}; total quota ${quota(report.totals.quotaMilliUnits)}.`)
  if (report.persistenceError !== undefined) lines.push(`Persistence error: ${report.persistenceError}`)
  return lines.join('\n')
}
