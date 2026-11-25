import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { Config, type ModelConfig } from '../src/config.js'
import { assessTask, nearestEffort, selectRoute } from '../src/routing.js'
import { priceUsage, quotaUsage } from '../src/usage.js'

const subscriptionModel: ModelConfig = {
  provider: 'kimi-coding',
  model: 'k3.1-pro',
  capability: 5,
  speed: 3,
  input: ['text', 'image'],
  reasoningEfforts: ['off', 'low', 'high', 'max'],
  billing: {
    kind: 'subscription',
    subscription: 'kimi',
    quota: {
      requestMilliUnits: 1000,
      inputMilliUnitsPerMillionTokens: 0,
      cacheReadMilliUnitsPerMillionTokens: 0,
      cacheWriteMilliUnitsPerMillionTokens: 0,
      outputMilliUnitsPerMillionTokens: 2000,
    },
  },
}

const paidModel: ModelConfig = {
  provider: 'openrouter',
  model: 'example/pro',
  capability: 5,
  speed: 5,
  input: ['text', 'image'],
  reasoningEfforts: ['off', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max'],
  billing: {
    kind: 'pay-as-you-go',
    prices: {
      inputMicroUsdPerMillionTokens: 3000,
      cacheReadMicroUsdPerMillionTokens: 300,
      cacheWriteMicroUsdPerMillionTokens: 3750,
      outputMicroUsdPerMillionTokens: 15000,
    },
  },
}

function config(strategy: 'balanced' | 'cash' | 'subscription' | 'quality' | 'speed' = 'balanced', models = [subscriptionModel, paidModel]) {
  return Config.parse({
    strategy,
    models,
    subscriptions: [{
      id: 'kimi',
      windowHours: 720,
      windowAnchor: '2026-01-01T00:00:00.000Z',
      quotaLimitMilliUnits: 100000,
      windowCostMicroUsd: 20000000,
    }],
  })
}

describe('task routing', () => {
  it('given_a_bounded_typo_task_when_assessed_then_requests_the_lowest_level', () => {
    const assessment = assessTask(config(), { text: 'Fix a typo in this label' })
    assert.equal(assessment.score, 1)
    assert.equal(assessment.desiredEffort, 'off')
  })

  it('given_a_security_refactor_when_assessed_then_requests_high_effort', () => {
    const assessment = assessTask(config(), { text: 'Implement and test a security refactor across the system-wide authorization flow' })
    assert.ok(assessment.score >= 4)
    assert.equal(assessment.desiredEffort, 'high')
  })

  it('given_an_image_task_when_routed_then_text_only_models_are_excluded', () => {
    const textOnly = { ...paidModel, provider: 'text', input: ['text'] as ['text'] }
    const decision = selectRoute(config('quality', [textOnly, subscriptionModel]), assessTask(config(), { text: 'Diagnose this screenshot', imageCount: 1 }))
    assert.equal(decision?.model.provider, 'kimi-coding')
  })

  it('given_a_file_without_an_image_when_routed_then_text_only_models_remain_eligible', () => {
    const textOnly = { ...paidModel, provider: 'text', input: ['text'] as ['text'] }
    const decision = selectRoute(config('quality', [textOnly]), assessTask(config(), { text: 'Explain this document', fileCount: 1 }))
    assert.equal(decision?.model.provider, 'text')
  })

  it('given_no_model_with_sufficient_capability_when_routed_then_returns_no_decision', () => {
    const weak = { ...subscriptionModel, capability: 1 }
    const assessment = assessTask(config(), { text: 'Implement a system-wide security refactor' })
    assert.equal(selectRoute(config('balanced', [weak]), assessment), undefined)
  })

  it('given_an_unsupported_desired_effort_when_selected_then_uses_the_nearest_lower_level_on_a_tie', () => {
    assert.equal(nearestEffort(['off', 'low', 'high', 'max'], 'medium'), 'low')
    assert.equal(nearestEffort(['off', 'high'], 'low'), 'off')
  })

  it('given_quality_strategy_when_routed_then_prefers_the_most_capable_model', () => {
    const weaker = { ...subscriptionModel, capability: 3 }
    const assessment = { ...assessTask(config(), { text: 'Explain this' }), score: 3 }
    const decision = selectRoute(config('quality', [weaker, paidModel]), assessment)
    assert.equal(decision?.model.provider, 'openrouter')
  })

  it('given_speed_strategy_when_routed_then_prefers_the_fastest_model', () => {
    const decision = selectRoute(config('speed'), assessTask(config(), { text: 'Fix this bug' }))
    assert.equal(decision?.model.provider, 'openrouter')
  })

  it('given_subscription_strategy_when_routed_then_prefers_subscription_before_speed', () => {
    const decision = selectRoute(config('subscription'), assessTask(config(), { text: 'Fix this bug' }))
    assert.equal(decision?.model.provider, 'kimi-coding')
  })

  it('given_equal_quality_and_speed_when_balanced_then_cash_and_quota_break_the_tie', () => {
    const equalPaid = { ...paidModel, speed: subscriptionModel.speed }
    const balanced = config('balanced', [subscriptionModel, equalPaid])
    if (balanced.subscriptions[0] !== undefined) balanced.subscriptions[0].windowCostMicroUsd = 0
    const decision = selectRoute(balanced, assessTask(balanced, { text: 'Fix this bug' }))
    assert.equal(decision?.model.provider, 'kimi-coding')
  })

  it('given_cash_strategy_and_two_paid_models_when_routed_then_prefers_lower_estimated_cash', () => {
    const cheapPaid = {
      ...paidModel,
      provider: 'cheap',
      speed: 1,
      billing: {
        kind: 'pay-as-you-go' as const,
        prices: {
          inputMicroUsdPerMillionTokens: 1,
          cacheReadMicroUsdPerMillionTokens: 1,
          cacheWriteMicroUsdPerMillionTokens: 1,
          outputMicroUsdPerMillionTokens: 1,
        },
      },
    }
    const decision = selectRoute(config('cash', [paidModel, cheapPaid]), assessTask(config(), { text: 'Fix this bug' }))
    assert.equal(decision?.model.provider, 'cheap')
  })

  it('given_an_exhausted_subscription_when_routed_then_uses_a_pay_as_you_go_fallback', () => {
    const assessment = assessTask(config(), { text: 'Fix this bug' })
    const decision = selectRoute(config('subscription'), assessment, new Map([['kimi', 100000000000n]]))
    assert.equal(decision?.model.provider, 'openrouter')
  })

  it('given_only_an_exhausted_subscription_when_routed_then_does_not_overspend_quota', () => {
    const assessment = assessTask(config(), { text: 'Fix this bug' })
    assert.equal(selectRoute(config('subscription', [subscriptionModel]), assessment, new Map([['kimi', 100000000000n]])), undefined)
  })
})

describe('usage arithmetic', () => {
  it('given_disjoint_cache_buckets_when_priced_then_each_uses_its_own_rate', () => {
    const prices = paidModel.billing.kind === 'pay-as-you-go' ? paidModel.billing.prices : assert.fail('expected paid route')
    assert.equal(priceUsage(prices, {
      inputTokens: 1000000,
      cacheReadTokens: 1000000,
      cacheWriteTokens: 1000000,
      outputTokens: 1000000,
    }), 22050n)
  })

  it('given_fractional_micro_usd_when_priced_then_rounds_down_once_after_summation', () => {
    assert.equal(priceUsage({
      inputMicroUsdPerMillionTokens: 1,
      cacheReadMicroUsdPerMillionTokens: 1,
      cacheWriteMicroUsdPerMillionTokens: 1,
      outputMicroUsdPerMillionTokens: 1,
    }, { inputTokens: 250000, cacheReadTokens: 250000, cacheWriteTokens: 250000, outputTokens: 250000 }), 1n)
  })

  it('given_subscription_usage_when_metered_then_request_and_token_quota_are_combined', () => {
    const quota = subscriptionModel.billing.kind === 'subscription' ? subscriptionModel.billing.quota : assert.fail('expected subscription')
    assert.equal(quotaUsage(quota, { inputTokens: 0, outputTokens: 1000 }), 1002n)
  })
})
