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
