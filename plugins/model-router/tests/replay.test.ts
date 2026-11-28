import { deepEqual, equal } from 'node:assert/strict'
import { test } from 'node:test'
import { Config } from '../src/config.js'
import { replayTask } from '../src/replay.js'

const prices = { inputMicroUsdPerMillionTokens: 1, outputMicroUsdPerMillionTokens: 1,
  cacheReadMicroUsdPerMillionTokens: 0, cacheWriteMicroUsdPerMillionTokens: 0 }
const config = Config.parse({ strategy: 'cash', models: [
  { provider: 'fixture', model: 'small', capability: 1, speed: 5, reasoningEfforts: ['off'], billing: { kind: 'pay-as-you-go', prices } },
  { provider: 'fixture', model: 'large', capability: 5, speed: 1, input: ['text', 'image'], reasoningEfforts: ['high'], billing: { kind: 'pay-as-you-go', prices: { ...prices, outputMicroUsdPerMillionTokens: 10 } } },
] })

const subscription = { ...config.models[0]!, billing: { kind: 'subscription' as const, subscription: 'plan', quota: { requestMilliUnits: 1 } } }
const paid = config.models[1]!
const paidPolicyConfig = Config.parse({ strategy: 'quality', models: [subscription, paid], subscriptions: [
  { id: 'plan', windowHours: 5, windowAnchor: '2026-01-01T00:00:00Z', quotaLimitMilliUnits: 10 },
] })
const verified = [{ provider: 'fixture', model: 'small' }]
const outcome = (model: string, effort: 'off' | 'high', lowerBps: number, upperBps: number) => ({
  provider: 'fixture', model, effort, lowerBps, upperBps,
})

test('given_comparable_outcome_bounds_when_the_paid_lower_bound_reaches_ten_times_the_subscription_upper_bound_then_paid_can_win', () => {
  const run = (lowerBps: number) => replayTask(paidPolicyConfig, { text: 'Say hello.' }, undefined, {
    minProbability: 0.8,
    subscriptionFirst: {
      verifiedIncludedRoutes: verified,
      paid: { maxEstimatedCashPicoUsd: 10_000n, outcomes: [outcome('small', 'off', 500, 900), outcome('large', 'high', lowerBps, 9500)] },
    },
  })
  equal(run(8999).advised?.model, 'small')
  equal(run(9000).advised?.model, 'large')
})

test('given_missing_comparable_evidence_or_a_paid_route_over_budget_when_replayed_then_the_included_route_wins', () => {
  for (const paidPolicy of [undefined,
    { maxEstimatedCashPicoUsd: 10_000n, outcomes: [outcome('large', 'high', 9000, 9500)] },
    { maxEstimatedCashPicoUsd: 100n, outcomes: [outcome('small', 'off', 500, 900), outcome('large', 'high', 9000, 9500)] },
  ]) {
    const result = replayTask(paidPolicyConfig, { text: 'Say hello.' }, { difficulty: 1, probability: 1 }, {
      minProbability: 0.8, subscriptionFirst: { verifiedIncludedRoutes: verified, paid: paidPolicy },
    })
    equal(result.baseline?.model, 'large')
    equal(result.advised?.model, 'small')
  }
})

test('given_a_stronger_eligible_subscription_when_paid_beats_only_the_default_then_no_paid_override', () => {
  const included = paidPolicyConfig.models[0]!
  const stronger = { ...included, model: 'stronger', speed: 3 }
  const result = replayTask({ ...paidPolicyConfig, strategy: 'speed', models: [included, stronger, paid] },
    { text: 'Say hello.' }, undefined, {
    minProbability: 0.8,
    subscriptionFirst: { verifiedIncludedRoutes: [...verified, { provider: 'fixture', model: stronger.model }],
      paid: { maxEstimatedCashPicoUsd: 10_000n, outcomes: [outcome('small', 'off', 500, 900),
        outcome('stronger', 'off', 800, 1000), outcome('large', 'high', 9000, 9500)] } },
  })
  equal(result.advised?.model, 'small')
})

test('given_unverified_or_exhausted_included_quota_when_replayed_then_no_route_is_selected_without_a_valid_comparator', () => {
  for (const [verifiedIncludedRoutes, quotaUsedNanoUnits] of [[[], new Map<string, bigint>()],
    [verified, new Map([['plan', 10_000_000n]])]] as const) {
    const result = replayTask(paidPolicyConfig, { text: 'Say hello.' }, undefined, {
      minProbability: 0.8, quotaUsedNanoUnits,
      subscriptionFirst: { verifiedIncludedRoutes, paid: { maxEstimatedCashPicoUsd: 10_000n,
        outcomes: [outcome('small', 'off', 500, 900), outcome('large', 'high', 9000, 9500)] } },
    })
    equal(result.advised, null)
  }
})

test('given_a_short_task_with_a_saved_high_difficulty_assessment_when_replayed_then_only_the_advised_route_changes', () => {
  const result = replayTask(config, { text: 'Why does this happen?' }, { difficulty: 4, probability: 0.95 }, { minProbability: 0.8 })
  equal(result.baseline?.model, 'small')
  equal(result.advised?.model, 'large')
  equal(result.advised?.effort, 'high')
  equal(result.assessment, 'accepted')
})

test('given_uncertain_or_invalid_assessments_when_replayed_then_the_local_choice_is_unchanged', () => {
  for (const saved of [undefined, { difficulty: 4, probability: 0.3 }, { difficulty: 100, probability: 1 }, { difficulty: 4, probability: 2 }]) {
    const result = replayTask(config, { text: 'Why does this happen?' }, saved, { minProbability: 0.8 })
    deepEqual(result.baseline, result.advised)
    equal(result.assessment, 'local-fallback')
  }
})

test('given_an_actual_image_when_saved_advice_says_it_is_not_needed_then_replay_still_requires_vision', () => {
  const result = replayTask(config, { text: 'Read this.', imageCount: 1 }, { difficulty: 1, probability: 1, needsVision: false }, { minProbability: 0.8 })
  equal(result.advised?.model, 'large')
})

test('given_advice_that_an_unattached_image_is_needed_when_replayed_then_no_model_is_recommended', () => {
  const result = replayTask(config, { text: 'Read the screenshot.' }, { difficulty: 1, probability: 1, needsVision: true }, { minProbability: 0.8 })
  equal(result.advised, null)
  equal(result.assessment, 'missing-image')
})
