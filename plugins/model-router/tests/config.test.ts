import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { Config } from '../src/config.js'

const model = {
  provider: 'route', model: 'model', capability: 3, speed: 3,
  billing: {
    kind: 'pay-as-you-go',
    prices: {
      inputMicroUsdPerMillionTokens: 1,
      cacheReadMicroUsdPerMillionTokens: 1,
      cacheWriteMicroUsdPerMillionTokens: 1,
      outputMicroUsdPerMillionTokens: 1,
    },
  },
}

describe('configuration', () => {
  it('given_an_omitted_bundle_config_when_mounted_then_defaults_are_materialized', () => {
    // Regression: mounted DSH 0.2.2-rc.5 passed undefined to an unconfigured bundle entry.
    const config = Config.parse(undefined)
    assert.equal(config.enabled, true)
    assert.equal(config.strategy, 'balanced')
    assert.deepEqual(config.models, [])
  })

  it('given_minimal_models_when_parsed_then_explicit_defaults_are_materialized', () => {
    const config = Config.parse({ models: [model] })
    assert.equal(config.enabled, true)
    assert.equal(config.models[0]?.input[0], 'text')
    assert.equal(config.effortByScore[3], 'high')
  })

  it('given_duplicate_routes_when_validated_then_rejected', () => {
    assert.throws(() => Config.parse({ models: [model, model] }), /duplicate provider\/model route/u)
  })

  it('given_an_unknown_subscription_reference_when_validated_then_rejected', () => {
    assert.throws(() => Config.parse({
      models: [{
        ...model,
        billing: {
          kind: 'subscription', subscription: 'missing',
          quota: {
            requestMilliUnits: 1,
            inputMilliUnitsPerMillionTokens: 0,
            cacheReadMilliUnitsPerMillionTokens: 0,
            cacheWriteMilliUnitsPerMillionTokens: 0,
            outputMilliUnitsPerMillionTokens: 0,
          },
        },
      }],
    }), /unknown subscription/u)
  })

  it('given_all_zero_weights_when_validated_then_rejected', () => {
    assert.throws(() => Config.parse({ weights: { quality: 0, speed: 0, cash: 0, quota: 0 } }), /at least one routing weight/u)
  })

  it('given_an_unknown_field_when_validated_then_rejected', () => {
    assert.throws(() => Config.parse({ models: [model], stratgy: 'cash' }))
  })
})
