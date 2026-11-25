import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { Context } from '@deepseek-ai/cordis'
import type { GenerateOptions, StreamChunk } from '@deepseek-ai/dsh-llm'
import { Config } from '../src/config.js'
import { HealthProbeRunner } from '../src/health.js'
import { MetricsStore } from '../src/metrics.js'
import { createUsageReport } from '../src/report.js'

const now = new Date('2026-11-25T12:00:00.000Z')

function config(healthProbe = false) {
  return Config.parse({
    dailyRetentionDays: 7,
    health: {
      failureThreshold: 3,
      degradedLatencyMs: 1000,
      retryAfterMs: 1000,
      probeIntervalMs: 60000,
      probeTimeoutMs: 1000,
      probeMaxOutputTokens: 1,
    },
    models: [{
      provider: 'paid', model: 'pro', capability: 5, speed: 3, healthProbe,
      reasoningEfforts: ['off', 'high'],
      billing: {
        kind: 'pay-as-you-go',
        prices: {
          inputMicroUsdPerMillionTokens: 1,
          cacheReadMicroUsdPerMillionTokens: 1,
          cacheWriteMicroUsdPerMillionTokens: 1,
          outputMicroUsdPerMillionTokens: 1,
        },
      },
    }],
  })
}

async function store(configValue = config()) {
  const directory = await mkdtemp(join(tmpdir(), 'model-router-health-'))
  return await MetricsStore.load(join(directory, 'metrics.json'), configValue)
}

function probeRunner(
  metrics: MetricsStore,
  configValue: Config,
  stream: (options: GenerateOptions) => AsyncIterable<StreamChunk>,
) {
  let dispose: (() => Promise<void> | void) | undefined
  const ctx = Object.assign(new Context(), {
    logger: { warn() {} },
    llm: { stream },
    effect(callback: () => (() => Promise<void> | void)) {
      const disposer = callback()
      dispose = disposer
      return disposer
    },
  })
  const runner = new HealthProbeRunner(ctx, configValue, metrics)
  return {
    runner,
    start() { runner.start() },
    async dispose() { await dispose?.() },
  }
}

describe('dashboard history and route health', () => {
  it('given_a_legacy_v2_file_without_history_when_loaded_then_defaults_preserve_existing_data', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'model-router-legacy-'))
    const path = join(directory, 'metrics.json')
    await writeFile(path, JSON.stringify({ version: 2, routes: {}, subscriptionWindows: {} }))
    const metrics = await MetricsStore.load(path, config())
    assert.deepEqual(metrics.snapshot().daily, {})
    assert.deepEqual(metrics.snapshot().health, {})
    assert.equal(metrics.snapshot().version, 2)
  })

  it('given_daily_requests_beyond_retention_when_recorded_then_buckets_are_bounded_and_exact', async () => {
    const configValue = config()
    const metrics = await store(configValue)
    for (let day = 1; day <= 8; day += 1) {
      await metrics.record({
        provider: 'paid', model: 'pro', outcome: 'completed', latencyMs: 10,
        usage: { inputTokens: 0, outputTokens: 1 }, now: new Date(Date.UTC(2026, 0, day)),
      })
    }
    const days = Object.keys(metrics.snapshot().daily['paid\0pro'] ?? {})
    assert.equal(days.length, 7)
    assert.equal(days[0], '2026-01-02')
    assert.equal(metrics.snapshot().routes['paid\0pro']?.requests, 8)
    assert.equal(metrics.snapshot().daily['paid\0pro']?.['2026-01-08']?.cashPicoUsd, '1')
  })

  it('given_repeated_failures_when_health_is_read_then_route_waits_for_retry_and_recovers', async () => {
    const configValue = config()
    const metrics = await store(configValue)
    for (let count = 0; count < 3; count += 1) {
      await metrics.record({ provider: 'paid', model: 'pro', outcome: 'failed', failureCode: 'RATE_LIMIT', latencyMs: 5, now })
    }
    assert.equal(metrics.snapshot().health['paid\0pro']?.status, 'unhealthy')
    assert.equal(metrics.isRoutable('paid', 'pro', now), false)
    assert.equal(metrics.isRoutable('paid', 'pro', new Date(now.getTime() + 1000)), true)
    await metrics.record({ provider: 'paid', model: 'pro', outcome: 'completed', latencyMs: 10, now: new Date(now.getTime() + 1000) })
    assert.equal(metrics.snapshot().health['paid\0pro']?.status, 'healthy')
    await metrics.record({ provider: 'paid', model: 'pro', outcome: 'completed', latencyMs: 1000, now })
    assert.equal(metrics.snapshot().health['paid\0pro']?.status, 'degraded')
  })

  it('given_user_cancellation_when_health_is_read_then_it_is_not_a_provider_failure', async () => {
    const metrics = await store()
    await metrics.record({ provider: 'paid', model: 'pro', outcome: 'aborted', failureCode: 'ABORTED', latencyMs: 5, now })
    assert.equal(metrics.snapshot().health['paid\0pro']?.status, 'unknown')
    assert.equal(metrics.snapshot().health['paid\0pro']?.consecutiveFailures, 0)
    assert.equal(metrics.snapshot().health['paid\0pro']?.lastFailureCode, undefined)
  })

  it('given_configured_routes_without_traffic_when_reported_then_unknown_health_is_visible', () => {
    const report = createUsageReport({ version: 2, routes: {}, daily: {}, health: {}, subscriptionWindows: {} }, config(), now)
    assert.equal(report.routes.length, 1)
    assert.equal(report.routes[0]?.requests, 0)
    assert.equal(report.routes[0]?.health.status, 'unknown')
    assert.equal(report.healthSummary.unknown, 1)
  })

  it('given_default_probe_config_when_started_then_no_probe_or_timer_is_created', async () => {
    const metrics = await store()
    let calls = 0
    const probes = probeRunner(metrics, config(), async function* () { calls += 1 })
    probes.start()
    await probes.runner.whenIdle()
    await probes.dispose()
    assert.equal(calls, 0)
    assert.equal(metrics.snapshot().routes['paid\0pro'], undefined)
  })

  it('given_enabled_successful_probe_when_settled_then_health_and_exact_cost_are_recorded', async () => {
    const configValue = config(true)
    const metrics = await store(configValue)
    const probes = probeRunner(metrics, configValue, async function* () {
      yield { type: 'usage', usage: { inputTokens: 100, outputTokens: 10 } }
      yield { type: 'finish', reason: { kind: 'stop' } }
    })
    probes.start()
    await probes.runner.whenIdle()
    await probes.dispose()
    assert.equal(metrics.snapshot().routes['paid\0pro']?.cashPicoUsd, '110')
    assert.equal(metrics.snapshot().health['paid\0pro']?.status, 'healthy')
    assert.ok(metrics.snapshot().health['paid\0pro']?.lastProbeAt)
  })

  it('given_failed_probe_with_raw_message_when_recorded_then_only_failure_code_is_retained', async () => {
    const configValue = config(true)
    configValue.health.failureThreshold = 1
    const metrics = await store(configValue)
    const probes = probeRunner(metrics, configValue, async function* () {
      yield {
        type: 'finish',
        reason: { kind: 'error', failure: { code: 'RATE_LIMIT', message: 'secret provider detail' } },
      }
    })
    probes.start()
    await probes.runner.whenIdle()
    await probes.dispose()
    assert.equal(metrics.snapshot().health['paid\0pro']?.status, 'unhealthy')
    assert.equal(metrics.snapshot().health['paid\0pro']?.lastFailureCode, 'RATE_LIMIT')
    assert.doesNotMatch(JSON.stringify(metrics.snapshot()), /secret provider detail/u)
  })

  it('given_probe_timeout_when_settled_then_it_degrades_health_as_a_failure', async () => {
    const configValue = config(true)
    configValue.health.failureThreshold = 1
    configValue.health.probeTimeoutMs = 5
    const metrics = await store(configValue)
    const probes = probeRunner(metrics, configValue, (options: GenerateOptions) => (async function* () {
      await new Promise<void>(resolve => options.signal?.addEventListener('abort', () => resolve(), { once: true }))
      yield { type: 'finish', reason: { kind: 'aborted', failure: { code: 'ABORTED', message: 'timeout' } } }
    })())
    probes.start()
    await probes.runner.whenIdle()
    await probes.dispose()
    assert.equal(metrics.snapshot().health['paid\0pro']?.status, 'unhealthy')
    assert.equal(metrics.snapshot().health['paid\0pro']?.lastFailureCode, 'TIMEOUT')
  })

  it('given_probe_in_flight_when_disposed_then_it_aborts_and_reaches_quiescence', async () => {
    const configValue = config(true)
    const metrics = await store(configValue)
    let observedSignal: AbortSignal | undefined
    const probes = probeRunner(metrics, configValue, (options: GenerateOptions) => (async function* () {
      observedSignal = options.signal
      yield { type: 'usage', usage: { inputTokens: 0, outputTokens: 0 } }
      await new Promise<void>(resolve => options.signal?.addEventListener('abort', () => resolve(), { once: true }))
      yield { type: 'finish', reason: { kind: 'aborted', failure: { code: 'ABORTED', message: 'cancelled' } } }
    })())
    probes.start()
    await new Promise(resolve => setImmediate(resolve))
    await probes.dispose()
    assert.equal(observedSignal?.aborted, true)
    assert.equal(metrics.snapshot().routes['paid\0pro']?.aborted, 1)
  })
})
