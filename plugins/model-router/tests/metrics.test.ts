import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { Config } from '../src/config.js'
import { applyMeasurement, emptyMetricsState, MetricsStore, type MetricsState } from '../src/metrics.js'
import { createUsageReport, formatUsageReport } from '../src/report.js'
import { assessTask, currentWindowStart, selectRoute } from '../src/routing.js'

const now = new Date('2026-11-25T12:00:00.000Z')
const testConfig = Config.parse({
  models: [
    {
      provider: 'paid', model: 'pro', capability: 5, speed: 4,
      billing: {
        kind: 'pay-as-you-go',
        prices: {
          inputMicroUsdPerMillionTokens: 1000000,
          cacheReadMicroUsdPerMillionTokens: 100000,
          cacheWriteMicroUsdPerMillionTokens: 200000,
          outputMicroUsdPerMillionTokens: 3000000,
        },
      },
    },
    {
      provider: 'sub', model: 'pro', capability: 5, speed: 3,
      billing: {
        kind: 'subscription', subscription: 'plan',
        quota: {
          requestMilliUnits: 1000,
          inputMilliUnitsPerMillionTokens: 1000,
          cacheReadMilliUnitsPerMillionTokens: 100,
          cacheWriteMilliUnitsPerMillionTokens: 200,
          outputMilliUnitsPerMillionTokens: 3000,
        },
      },
    },
  ],
  subscriptions: [{
    id: 'plan', windowHours: 5, windowAnchor: '2026-11-25T10:00:00.000Z',
    quotaLimitMilliUnits: 10000, windowCostMicroUsd: 1000000,
  }],
})

function planWindowQuota(state: MetricsState, date: Date): string | undefined {
  const subscription = testConfig.subscriptions[0]
  assert.ok(subscription)
  return state.subscriptionWindows.plan?.[currentWindowStart(subscription, date)]?.quotaNanoUnits
}

describe('metrics', () => {
  it('given_pay_as_you_go_usage_when_recorded_then_tracks_cash_tokens_and_outcome', () => {
    const state = emptyMetricsState()
    applyMeasurement(state, testConfig, {
      provider: 'paid', model: 'pro', outcome: 'completed', latencyMs: 2000, now,
      usage: { inputTokens: 100, cacheReadTokens: 1000, cacheWriteTokens: 500, outputTokens: 200, reasoningTokens: 50 },
    })
    const stats = state.routes['paid\0pro']
    assert.equal(stats?.requests, 1)
    assert.equal(stats?.completed, 1)
    assert.equal(stats?.cashPicoUsd, '900000000')
    assert.equal(stats?.equivalentNumerator, '900000000')
    assert.equal(stats?.equivalentDenominator, '1')
    assert.equal(stats?.tokens.reasoning, '50')
  })

  it('given_subscription_usage_when_recorded_then_tracks_quota_and_equivalent_value_without_cash', () => {
    const state = emptyMetricsState()
    applyMeasurement(state, testConfig, {
      provider: 'sub', model: 'pro', outcome: 'completed', latencyMs: 1000, now,
      usage: { inputTokens: 1000, outputTokens: 1000 },
    })
    const stats = state.routes['sub\0pro']
    assert.equal(stats?.cashPicoUsd, '0')
    assert.equal(stats?.quotaNanoUnits, '1004000000')
    assert.equal(stats?.equivalentNumerator, '1004000000000000')
    assert.equal(stats?.equivalentDenominator, '10000')
    assert.equal(planWindowQuota(state, now), '1004000000')
  })

  it('given_a_new_subscription_window_when_recorded_then_old_window_quota_does_not_leak', () => {
    const state = emptyMetricsState()
    const measurement = {
      provider: 'sub', model: 'pro', outcome: 'completed' as const, latencyMs: 10,
      usage: { inputTokens: 0, outputTokens: 0 },
    }
    applyMeasurement(state, testConfig, { ...measurement, now: new Date('2026-11-25T12:00:00.000Z') })
    applyMeasurement(state, testConfig, { ...measurement, now: new Date('2026-11-25T16:00:00.000Z') })
    assert.equal(planWindowQuota(state, new Date('2026-11-25T16:00:00.000Z')), '1000000000')
    assert.equal(state.routes['sub\0pro']?.quotaNanoUnits, '2000000000')
  })

  it('given_an_unconfigured_route_when_reported_then_money_is_not_invented', () => {
    const state = emptyMetricsState()
    applyMeasurement(state, testConfig, { provider: 'other', model: 'unknown', outcome: 'failed', latencyMs: 50, now })
    const report = createUsageReport(state, testConfig, now)
    assert.equal(report.routes[0]?.billing, 'unconfigured')
    assert.equal(report.routes[0]?.cashMicroUsd, '0')
    assert.equal(report.routes[0]?.equivalentMicroUsd, null)
    assert.equal(report.routes[0]?.failed, 1)
  })

  it('given_user_feedback_when_reported_then_rated_success_is_separate_from_completion', () => {
    const state = emptyMetricsState()
    applyMeasurement(state, testConfig, { provider: 'paid', model: 'pro', outcome: 'completed', latencyMs: 50, now })
    const stats = state.routes['paid\0pro']
    assert.ok(stats)
    stats.ratedGood = 3
    stats.ratedBad = 1
    const report = createUsageReport(state, testConfig, now)
    assert.equal(report.routes[0]?.ratedSuccessBasisPoints, 7500)
    assert.equal(report.routes[0]?.completed, 1)
  })

  it('given_subscription_windows_when_computed_then_the_anchor_controls_the_boundary', () => {
    const subscription = testConfig.subscriptions[0]
    assert.ok(subscription)
    assert.equal(currentWindowStart(subscription, new Date('2026-11-25T14:59:59.999Z')), Date.parse('2026-11-25T10:00:00.000Z').toString())
    assert.equal(currentWindowStart(subscription, new Date('2026-11-25T15:00:00.000Z')), Date.parse('2026-11-25T15:00:00.000Z').toString())
  })

  it('given_equivalent_subscription_value_when_formatted_then_it_is_not_hidden', () => {
    const state = emptyMetricsState()
    applyMeasurement(state, testConfig, {
      provider: 'sub', model: 'pro', outcome: 'completed', latencyMs: 1000, now,
      usage: { inputTokens: 1000, outputTokens: 1000 },
    })
    const text = formatUsageReport(createUsageReport(state, testConfig, now))
    assert.match(text, /equivalent value \$0\.100400/u)
    assert.match(text, /cash \$0\.000000/u)
  })

  it('given_invalid_provider_usage_when_recorded_then_rejects_before_mutating_metrics', () => {
    const state = emptyMetricsState()
    assert.throws(() => applyMeasurement(state, testConfig, {
      provider: 'paid', model: 'pro', outcome: 'completed', latencyMs: 50, now,
      usage: { inputTokens: -1, outputTokens: 0 },
    }), /token counts must be non-negative safe integers/u)
    assert.deepEqual(state, emptyMetricsState())
  })

  it('given_repeated_fractional_requests_when_aggregated_then_cash_and_quota_remain_exact', () => {
    const state = emptyMetricsState()
    const config = structuredClone(testConfig)
    const paid = config.models.find(model => model.provider === 'paid')
    const subscription = config.models.find(model => model.provider === 'sub')
    assert.ok(paid?.billing.kind === 'pay-as-you-go')
    assert.ok(subscription?.billing.kind === 'subscription')
    paid.billing.prices.outputMicroUsdPerMillionTokens = 1
    subscription.billing.quota.requestMilliUnits = 0
    subscription.billing.quota.outputMilliUnitsPerMillionTokens = 1
    for (let index = 0; index < 2; index += 1) {
      applyMeasurement(state, config, {
        provider: 'paid', model: 'pro', outcome: 'completed', latencyMs: 10, now,
        usage: { inputTokens: 0, outputTokens: 500000 },
      })
      applyMeasurement(state, config, {
        provider: 'sub', model: 'pro', outcome: 'completed', latencyMs: 10, now,
        usage: { inputTokens: 0, outputTokens: 500000 },
      })
    }
    const report = createUsageReport(state, config, now)
    assert.equal(report.routes.find(route => route.provider === 'paid')?.cashMicroUsd, '1')
    assert.equal(report.routes.find(route => route.provider === 'paid')?.cashPicoUsd, '1000000')
    assert.equal(report.routes.find(route => route.provider === 'sub')?.quotaMilliUnits, '1')
    assert.equal(report.routes.find(route => route.provider === 'sub')?.quotaNanoUnits, '1000000')
    assert.equal(report.routes.find(route => route.provider === 'sub')?.equivalentMicroUsd, '100')
    assert.equal(report.totals.cashMicroUsd, '1')
    assert.equal(report.totals.cashPicoUsd, '1000000')
    assert.equal(report.totals.quotaMilliUnits, '1')
    assert.equal(report.totals.quotaNanoUnits, '1000000')
  })

  it('given_a_local_failure_without_usage_when_recorded_then_no_subscription_quota_is_burned', () => {
    const state = emptyMetricsState()
    applyMeasurement(state, testConfig, {
      provider: 'sub', model: 'pro', outcome: 'failed', latencyMs: 0, now,
    })
    assert.equal(state.routes['sub\0pro']?.quotaNanoUnits, '0')
    assert.equal(planWindowQuota(state, now), '0')
  })

  it('given_competing_quota_reservations_when_admitted_then_estimates_cannot_overspend_the_limit', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'model-router-reservations-'))
    const config = Config.parse({ ...structuredClone(testConfig), strategy: 'subscription' })
    const subscription = config.subscriptions[0]
    const model = config.models.find(item => item.provider === 'sub')
    assert.ok(subscription)
    assert.ok(model?.billing.kind === 'subscription')
    subscription.quotaLimitMilliUnits = 1500
    model.billing.quota.requestMilliUnits = 600
    model.billing.quota.inputMilliUnitsPerMillionTokens = 0
    model.billing.quota.cacheReadMilliUnitsPerMillionTokens = 0
    model.billing.quota.cacheWriteMilliUnitsPerMillionTokens = 0
    model.billing.quota.outputMilliUnitsPerMillionTokens = 0
    const store = await MetricsStore.load(join(directory, 'metrics.json'), config)
    const assessment = assessTask(config, { text: 'Fix this bug' })
    const first = selectRoute(config, assessment, store.quotaBySubscription(now))
    assert.ok(first?.model.provider === 'sub')
    const firstReservation = store.reserve('session-1', first, now)
    const second = selectRoute(config, assessment, store.quotaBySubscription(now))
    assert.ok(second?.model.provider === 'sub')
    store.reserve('session-2', second, now)
    const third = selectRoute(config, assessment, store.quotaBySubscription(now))
    assert.equal(third?.model.provider, 'paid')
    assert.ok(firstReservation)
    await store.record({ provider: 'sub', model: 'pro', outcome: 'failed', latencyMs: 0, now }, firstReservation)
    assert.equal(store.quotaBySubscription(now).get('plan'), 600000000n)
    assert.equal(store.snapshot().routes['sub\0pro']?.quotaNanoUnits, '0')
    store.releaseSessionReservations('session-2')
    assert.equal(store.quotaBySubscription(now).get('plan'), 0n)
  })

  it('given_out_of_order_settlements_across_rollover_when_recorded_then_each_window_keeps_its_usage', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'model-router-rollover-'))
    const config = Config.parse({ ...structuredClone(testConfig), strategy: 'subscription' })
    const model = config.models.find(item => item.provider === 'sub')
    assert.ok(model?.billing.kind === 'subscription')
    model.billing.quota.requestMilliUnits = 600
    model.billing.quota.inputMilliUnitsPerMillionTokens = 0
    model.billing.quota.cacheReadMilliUnitsPerMillionTokens = 0
    model.billing.quota.cacheWriteMilliUnitsPerMillionTokens = 0
    model.billing.quota.outputMilliUnitsPerMillionTokens = 0
    const store = await MetricsStore.load(join(directory, 'metrics.json'), config)
    const assessment = assessTask(config, { text: 'Fix this bug' })
    const beforeRollover = new Date('2026-11-25T14:59:59.000Z')
    const afterRollover = new Date('2026-11-25T15:00:01.000Z')
    const first = selectRoute(config, assessment, store.quotaBySubscription(beforeRollover))
    assert.ok(first?.model.provider === 'sub')
    const firstReservation = store.reserve('session-1', first, beforeRollover)
    const second = selectRoute(config, assessment, store.quotaBySubscription(afterRollover))
    assert.ok(second?.model.provider === 'sub')
    const secondReservation = store.reserve('session-2', second, afterRollover)
    assert.ok(firstReservation)
    assert.ok(secondReservation)
    await store.record({
      provider: 'sub', model: 'pro', outcome: 'completed', latencyMs: 100,
      usage: { inputTokens: 0, outputTokens: 0 }, now: afterRollover,
    }, secondReservation)
    assert.equal(planWindowQuota(store.snapshot(), afterRollover), '600000000')
    await store.record({
      provider: 'sub', model: 'pro', outcome: 'completed', latencyMs: 200,
      usage: { inputTokens: 0, outputTokens: 0 }, now: afterRollover,
    }, firstReservation)
    assert.equal(planWindowQuota(store.snapshot(), beforeRollover), '600000000')
    assert.equal(planWindowQuota(store.snapshot(), afterRollover), '600000000')
    assert.equal(store.quotaBySubscription(afterRollover).get('plan'), 600000000n)
  })

  it('given_two_store_writers_when_they_finish_then_both_measurements_survive', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'model-router-writers-'))
    const path = join(directory, 'metrics.json')
    const first = await MetricsStore.load(path, testConfig)
    const second = await MetricsStore.load(path, testConfig)
    await Promise.all([
      first.record({ provider: 'paid', model: 'pro', outcome: 'completed', latencyMs: 10, now }),
      second.record({ provider: 'paid', model: 'pro', outcome: 'completed', latencyMs: 20, now }),
    ])
    const restored = await MetricsStore.load(path, testConfig)
    assert.equal(restored.snapshot().routes['paid\0pro']?.requests, 2)
    assert.equal(restored.snapshot().routes['paid\0pro']?.latencyMs, '30')
  })

  it('given_saved_metrics_when_reloaded_then_usage_survives', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'model-router-'))
    const path = join(directory, 'nested', 'metrics.json')
    const store = await MetricsStore.load(path, testConfig)
    await store.record({ provider: 'paid', model: 'pro', outcome: 'completed', latencyMs: 20, now })
    const restored = await MetricsStore.load(path, testConfig)
    assert.equal(restored.snapshot().routes['paid\0pro']?.requests, 1)
    const saved = JSON.parse(await readFile(path, 'utf8')) as { version: number }
    assert.equal(saved.version, 2)
  })

  it('given_corrupt_metrics_when_loaded_then_fails_without_replacing_the_file', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'model-router-'))
    const path = join(directory, 'metrics.json')
    await writeFile(path, '{broken')
    await assert.rejects(MetricsStore.load(path, testConfig), /cannot load metrics/u)
    assert.equal(await readFile(path, 'utf8'), '{broken')
  })
})
