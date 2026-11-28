import { z } from 'zod'
import type { Config } from './config.js'
import { assessTask, selectRoute, type RouteDecision, type TaskInput } from './routing.js'

const probability = z.number().min(0).max(1)
const adviceSchema = z.object({
  difficulty: z.union([z.literal(1), z.literal(2), z.literal(3), z.literal(4), z.literal(5)]),
  probability,
  needsVision: z.boolean().optional(),
}).strict()

function summarize(decision: RouteDecision | undefined) {
  return decision === undefined ? null : {
    provider: decision.model.provider,
    model: decision.model.model,
    effort: decision.reasoningEffort,
    difficulty: decision.assessment.score,
    estimatedCashPicoUsd: decision.estimatedCashPicoUsd.toString(),
    estimatedQuotaNanoUnits: decision.estimatedQuotaNanoUnits.toString(),
  }
}

export function replayTask(config: Config, task: TaskInput, savedAdvice: unknown, options: {
  minProbability: number
  quotaUsedNanoUnits?: ReadonlyMap<string, bigint>
}) {
  const threshold = probability.parse(options.minProbability)
  const local = assessTask(config, task)
  const baseline = summarize(selectRoute(config, local, options.quotaUsedNanoUnits))
  const result = adviceSchema.safeParse(savedAdvice)
  if (!result.success || result.data.probability < threshold) {
    return { baseline, advised: baseline, assessment: 'local-fallback' as const }
  }
  const advice = result.data
  if (advice.needsVision === true && !local.requiresImageInput) {
    return { baseline, advised: null, assessment: 'missing-image' as const }
  }
  const advised = summarize(selectRoute(config, {
    ...local,
    score: advice.difficulty,
    desiredEffort: config.effortByScore[advice.difficulty],
    estimatedUsage: { ...local.estimatedUsage, outputTokens: config.estimatedOutputTokensByScore[advice.difficulty] },
  }, options.quotaUsedNanoUnits))
  return { baseline, advised, assessment: 'accepted' as const }
}
