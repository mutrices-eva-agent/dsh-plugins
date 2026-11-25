import { randomUUID } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { mkdir, readFile } from 'node:fs/promises'
import { dirname } from 'node:path'
import { withFileLock, writeFileAtomic } from '@deepseek-ai/dsh-atomic-write'
import { z } from 'zod'
import type { Config, ModelConfig } from './config.js'
import { currentWindowStart, type RouteDecision } from './routing.js'
import {
  addBigInt,
  priceUsagePicoUsd,
  quotaUsageNanoUnits,
  routeKey,
  ZERO_USAGE,
  type TokenUsage,
} from './usage.js'

const nonNegativeIntegerString = z.string().regex(/^(0|[1-9]\d*)$/u)
const positiveIntegerString = z.string().regex(/^[1-9]\d*$/u)

const tokenTotalsSchema = z.object({
  input: nonNegativeIntegerString,
  cacheRead: nonNegativeIntegerString,
  cacheWrite: nonNegativeIntegerString,
  output: nonNegativeIntegerString,
  reasoning: nonNegativeIntegerString,
}).strict()

const routeStatsSchema = z.object({
  requests: z.number().int().nonnegative(),
  completed: z.number().int().nonnegative(),
  failed: z.number().int().nonnegative(),
  aborted: z.number().int().nonnegative(),
  truncated: z.number().int().nonnegative(),
  tokens: tokenTotalsSchema,
  cashPicoUsd: nonNegativeIntegerString,
  equivalentNumerator: nonNegativeIntegerString,
  equivalentDenominator: positiveIntegerString,
  equivalentSamples: z.number().int().nonnegative(),
  quotaNanoUnits: nonNegativeIntegerString,
  latencyMs: nonNegativeIntegerString,
  ratedGood: z.number().int().nonnegative(),
  ratedBad: z.number().int().nonnegative(),
}).strict()

export const metricsStateSchema = z.object({
  version: z.literal(2),
  routes: z.record(z.string(), routeStatsSchema),
  subscriptionWindows: z.record(z.string(), z.record(z.string(), z.object({
    quotaNanoUnits: nonNegativeIntegerString,
  }).strict())),
}).strict()

export type MetricsState = z.infer<typeof metricsStateSchema>
export type RouteStats = MetricsState['routes'][string]
export type RequestOutcome = 'completed' | 'failed' | 'aborted' | 'truncated'

export interface RequestMeasurement {
  provider: string
  model: string
  usage?: TokenUsage
  latencyMs: number
  outcome: RequestOutcome
  now: Date
  subscriptionWindowStart?: string
}

type PendingOperation =
  | { type: 'record'; measurement: RequestMeasurement }
  | { type: 'rate'; provider: string; model: string; good: boolean }

interface Reservation {
  sessionId: string
  provider: string
  model: string
  subscription: string
  windowStart: string
  quotaNanoUnits: bigint
  claimed: boolean
}

export function emptyMetricsState(): MetricsState {
  return { version: 2, routes: {}, subscriptionWindows: {} }
}

function emptyRouteStats(): RouteStats {
  return {
    requests: 0,
    completed: 0,
    failed: 0,
    aborted: 0,
    truncated: 0,
    tokens: { input: '0', cacheRead: '0', cacheWrite: '0', output: '0', reasoning: '0' },
    cashPicoUsd: '0',
    equivalentNumerator: '0',
    equivalentDenominator: '1',
    equivalentSamples: 0,
    quotaNanoUnits: '0',
    latencyMs: '0',
    ratedGood: 0,
    ratedBad: 0,
  }
}

function increment(value: number): number {
  if (!Number.isSafeInteger(value) || value >= Number.MAX_SAFE_INTEGER) throw new Error('model-router: metric counter overflow')
  return value + 1
}

function greatestCommonDivisor(left: bigint, right: bigint): bigint {
  let a = left
  let b = right
  while (b !== 0n) {
    const remainder = a % b
    a = b
    b = remainder
  }
  return a === 0n ? 1n : a
}

function addEquivalent(stats: RouteStats, numerator: bigint, denominator: bigint): void {
  if (denominator <= 0n) throw new Error('model-router: equivalent-value denominator must be positive')
  if (stats.equivalentSamples === 0) {
    stats.equivalentNumerator = numerator.toString()
    stats.equivalentDenominator = denominator.toString()
  } else {
    const currentNumerator = BigInt(stats.equivalentNumerator)
    const currentDenominator = BigInt(stats.equivalentDenominator)
    const nextNumerator = currentNumerator * denominator + numerator * currentDenominator
    const nextDenominator = currentDenominator * denominator
    const divisor = greatestCommonDivisor(nextNumerator, nextDenominator)
    stats.equivalentNumerator = (nextNumerator / divisor).toString()
    stats.equivalentDenominator = (nextDenominator / divisor).toString()
  }
  stats.equivalentSamples = increment(stats.equivalentSamples)
}

function equivalentCost(model: ModelConfig, config: Config, quotaNanoUnits: bigint): { numerator: bigint; denominator: bigint } | undefined {
  const billing = model.billing
  if (billing.kind === 'pay-as-you-go') return undefined
  const subscription = config.subscriptions.find(item => item.id === billing.subscription)
  if (subscription?.windowCostMicroUsd === undefined || subscription.quotaLimitMilliUnits === 0) return undefined
  return {
    numerator: BigInt(subscription.windowCostMicroUsd) * quotaNanoUnits,
    denominator: BigInt(subscription.quotaLimitMilliUnits),
  }
}

function validateUsage(usage: TokenUsage): void {
  for (const value of [
    usage.inputTokens, usage.outputTokens, usage.cacheReadTokens, usage.cacheWriteTokens,
    usage.reasoningTokens, usage.totalTokens,
  ]) {
    if (value !== undefined && (!Number.isSafeInteger(value) || value < 0)) {
      throw new Error('model-router: token counts must be non-negative safe integers')
    }
  }
}

export function applyMeasurement(state: MetricsState, config: Config, measurement: RequestMeasurement): void {
  if (!Number.isSafeInteger(measurement.latencyMs) || measurement.latencyMs < 0) {
    throw new Error('model-router: latency must be a non-negative safe integer')
  }
  const usage = measurement.usage ?? ZERO_USAGE
  validateUsage(usage)
  const key = routeKey(measurement.provider, measurement.model)
  const stats = state.routes[key] ?? emptyRouteStats()
  state.routes[key] = stats
  stats.requests = increment(stats.requests)
  stats[measurement.outcome] = increment(stats[measurement.outcome])
  stats.latencyMs = addBigInt(stats.latencyMs, BigInt(measurement.latencyMs))
  stats.tokens.input = addBigInt(stats.tokens.input, BigInt(usage.inputTokens))
  stats.tokens.cacheRead = addBigInt(stats.tokens.cacheRead, BigInt(usage.cacheReadTokens ?? 0))
  stats.tokens.cacheWrite = addBigInt(stats.tokens.cacheWrite, BigInt(usage.cacheWriteTokens ?? 0))
  stats.tokens.output = addBigInt(stats.tokens.output, BigInt(usage.outputTokens))
  stats.tokens.reasoning = addBigInt(stats.tokens.reasoning, BigInt(usage.reasoningTokens ?? 0))
  const model = config.models.find(item => item.provider === measurement.provider && item.model === measurement.model)
  if (model === undefined) return
  const billing = model.billing
  if (billing.kind === 'pay-as-you-go') {
    const cash = priceUsagePicoUsd(billing.prices, usage)
    stats.cashPicoUsd = addBigInt(stats.cashPicoUsd, cash)
    addEquivalent(stats, cash, 1n)
    return
  }
  const quota = measurement.usage === undefined ? 0n : quotaUsageNanoUnits(billing.quota, usage)
  stats.quotaNanoUnits = addBigInt(stats.quotaNanoUnits, quota)
  const equivalent = equivalentCost(model, config, quota)
  if (equivalent !== undefined) addEquivalent(stats, equivalent.numerator, equivalent.denominator)
  const subscription = config.subscriptions.find(item => item.id === billing.subscription)
  if (subscription !== undefined) {
    const windowStart = measurement.subscriptionWindowStart ?? currentWindowStart(subscription, measurement.now)
    const windows = state.subscriptionWindows[subscription.id] ?? {}
    state.subscriptionWindows[subscription.id] = windows
    const current = windows[windowStart]
    if (current !== undefined) current.quotaNanoUnits = addBigInt(current.quotaNanoUnits, quota)
    else windows[windowStart] = { quotaNanoUnits: quota.toString() }
  }
}

function applyOperation(state: MetricsState, config: Config, operation: PendingOperation): void {
  if (operation.type === 'record') {
    applyMeasurement(state, config, operation.measurement)
    return
  }
  const stats = state.routes[routeKey(operation.provider, operation.model)]
  if (stats === undefined) return
  if (operation.good) stats.ratedGood = increment(stats.ratedGood)
  else stats.ratedBad = increment(stats.ratedBad)
}

function decodeMetrics(content: string, path: string): MetricsState {
  try {
    return metricsStateSchema.parse(JSON.parse(content))
  } catch (error: unknown) {
    throw new Error(`model-router: cannot load metrics at ${path}`, { cause: error })
  }
}

export class MetricsStore {
  private writeQueue: Promise<void> = Promise.resolve()
  private lastPersistenceError: string | undefined
  private pending: PendingOperation[] = []
  private readonly reservations = new Map<string, Reservation>()

  private constructor(
    private readonly path: string,
    private readonly config: Config,
    private state: MetricsState,
  ) {}

  static async load(path: string, config: Config): Promise<MetricsStore> {
    let state = emptyMetricsState()
    try {
      state = decodeMetrics(await readFile(path, 'utf8'), path)
    } catch (error: unknown) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
    }
    return new MetricsStore(path, config, state)
  }

  snapshot(): MetricsState {
    this.refresh()
    return structuredClone(this.state)
  }

  quotaBySubscription(now: Date): Map<string, bigint> {
    this.refresh()
    const result = new Map<string, bigint>()
    for (const subscription of this.config.subscriptions) {
      const windowStart = currentWindowStart(subscription, now)
      const current = this.state.subscriptionWindows[subscription.id]?.[windowStart]
      let used = current === undefined ? 0n : BigInt(current.quotaNanoUnits)
      for (const reservation of this.reservations.values()) {
        if (reservation.subscription === subscription.id && reservation.windowStart === windowStart) {
          used += reservation.quotaNanoUnits
        }
      }
      result.set(subscription.id, used)
    }
    return result
  }

  reserve(sessionId: string, decision: RouteDecision, now: Date): string | undefined {
    const billing = decision.model.billing
    if (billing.kind !== 'subscription' || decision.estimatedQuotaNanoUnits === 0n) return undefined
    const subscription = this.config.subscriptions.find(item => item.id === billing.subscription)
    if (subscription === undefined) return undefined
    const id = randomUUID()
    this.reservations.set(id, {
      sessionId,
      provider: decision.model.provider,
      model: decision.model.model,
      subscription: subscription.id,
      windowStart: currentWindowStart(subscription, now),
      quotaNanoUnits: decision.estimatedQuotaNanoUnits,
      claimed: false,
    })
    return id
  }

  claimReservation(sessionId: string, provider: string, model: string): string | undefined {
    for (const [id, reservation] of this.reservations) {
      if (!reservation.claimed && reservation.sessionId === sessionId
        && reservation.provider === provider && reservation.model === model) {
        reservation.claimed = true
        return id
      }
    }
    return undefined
  }

  releaseReservation(id: string | undefined): void {
    if (id !== undefined) this.reservations.delete(id)
  }

  releaseSessionReservations(sessionId: string): void {
    for (const [id, reservation] of this.reservations) {
      if (reservation.sessionId === sessionId) this.reservations.delete(id)
    }
  }

  async record(measurement: RequestMeasurement, reservationId?: string): Promise<void> {
    const reservation = reservationId === undefined ? undefined : this.reservations.get(reservationId)
    const settledMeasurement = reservation === undefined
      ? measurement
      : { ...measurement, subscriptionWindowStart: reservation.windowStart }
    try {
      applyMeasurement(this.state, this.config, settledMeasurement)
      this.pending.push({ type: 'record', measurement: settledMeasurement })
    } finally {
      this.releaseReservation(reservationId)
    }
    await this.persist()
  }

  async rate(provider: string, model: string, good: boolean): Promise<boolean> {
    this.refresh()
    const stats = this.state.routes[routeKey(provider, model)]
    if (stats === undefined) return false
    if (good) stats.ratedGood = increment(stats.ratedGood)
    else stats.ratedBad = increment(stats.ratedBad)
    this.pending.push({ type: 'rate', provider, model, good })
    await this.persist()
    return true
  }

  persistenceError(): string | undefined {
    return this.lastPersistenceError
  }

  private refresh(): void {
    let state = emptyMetricsState()
    try {
      state = decodeMetrics(readFileSync(this.path, 'utf8'), this.path)
    } catch (error: unknown) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
    }
    for (const operation of this.pending) applyOperation(state, this.config, operation)
    this.state = state
  }

  private async persist(): Promise<void> {
    const operation = this.writeQueue.catch(() => undefined).then(() => this.flushPending())
    this.writeQueue = operation
    try {
      await operation
      this.lastPersistenceError = undefined
    } catch (error: unknown) {
      this.lastPersistenceError = error instanceof Error ? error.message : String(error)
      throw error
    }
  }

  private async flushPending(): Promise<void> {
    if (this.pending.length === 0) return
    await mkdir(dirname(this.path), { recursive: true, mode: 0o700 })
    await withFileLock(this.path, async () => {
      let diskState = emptyMetricsState()
      try {
        diskState = decodeMetrics(await readFile(this.path, 'utf8'), this.path)
      } catch (error: unknown) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
      }
      const batch = [...this.pending]
      for (const operation of batch) applyOperation(diskState, this.config, operation)
      await writeFileAtomic(this.path, `${JSON.stringify(diskState, null, 2)}\n`, { mode: 0o600, dirMode: 0o700 })
      this.pending.splice(0, batch.length)
      for (const operation of this.pending) applyOperation(diskState, this.config, operation)
      this.state = diskState
    }, { waitMs: this.config.lockWaitMs })
  }
}
