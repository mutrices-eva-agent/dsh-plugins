import { z } from 'zod'
import { REASONING_EFFORTS, type Config } from './config.js'
import { assessTask, selectRoute, type RouteDecision, type TaskAssessment, type TaskInput } from './routing.js'

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

const outcomeBounds = z.object({
  provider: z.string().min(1),
  model: z.string().min(1),
  effort: z.enum(REASONING_EFFORTS),
  lowerBps: z.number().int().min(0).max(10_000),
  upperBps: z.number().int().min(0).max(10_000),
}).refine(({ lowerBps, upperBps }) => lowerBps <= upperBps)

type RouteRef = Pick<Config['models'][number], 'provider' | 'model'>
interface ReplayOptions {
  minProbability: number
  quotaUsedNanoUnits?: ReadonlyMap<string, bigint>
  subscriptionFirst?: {
    verifiedIncludedRoutes: readonly RouteRef[]
    paid?: {
      maxEstimatedCashPicoUsd: bigint
      outcomes: readonly z.input<typeof outcomeBounds>[]
    } | undefined
  }
}

function selectAdvisedRoute(config: Config, assessment: TaskAssessment, options: ReplayOptions) {
  const quota = options.quotaUsedNanoUnits
  const policy = options.subscriptionFirst
  if (!policy) return selectRoute(config, assessment, quota)

  const subscriptions = config.models.filter(model => model.billing.kind === 'subscription'
    && policy.verifiedIncludedRoutes.some(route => route.provider === model.provider && route.model === model.model))
  const included = selectRoute({ ...config, models: subscriptions }, assessment, quota)
  const paid = policy.paid
  if (!included || !paid) return included

  const evidence = z.array(outcomeBounds).safeParse(paid.outcomes)
  if (!evidence.success) return included
  const boundsFor = (decision: RouteDecision) => {
    const matches = evidence.data.filter(row => row.provider === decision.model.provider
      && row.model === decision.model.model && row.effort === decision.reasoningEffort)
    return matches.length === 1 ? matches[0] : undefined
  }
  let subscriptionUpperBps = 0
  for (const subscription of subscriptions) {
    const candidate = selectRoute({ ...config, models: [subscription] }, assessment, quota)
    if (!candidate) continue
    const bounds = boundsFor(candidate)
    if (!bounds) return included
    subscriptionUpperBps = Math.max(subscriptionUpperBps, bounds.upperBps)
  }
  if (subscriptionUpperBps === 0) return included

  const allowedPaid = config.models.filter(model => {
    if (model.billing.kind !== 'pay-as-you-go') return false
    const candidate = selectRoute({ ...config, models: [model] }, assessment, quota)
    if (!candidate || candidate.estimatedCashPicoUsd > paid.maxEstimatedCashPicoUsd) return false
    const bounds = boundsFor(candidate)
    return bounds !== undefined && bounds.lowerBps >= 10 * subscriptionUpperBps
  })
  return selectRoute({ ...config, models: allowedPaid }, assessment, quota) ?? included
}

export function replayTask(config: Config, task: TaskInput, savedAdvice: unknown, options: ReplayOptions) {
  const threshold = probability.parse(options.minProbability)
  const local = assessTask(config, task)
  const baseline = summarize(selectRoute(config, local, options.quotaUsedNanoUnits))
  const result = adviceSchema.safeParse(savedAdvice)
  if (!result.success || result.data.probability < threshold) {
    return { baseline, advised: summarize(selectAdvisedRoute(config, local, options)), assessment: 'local-fallback' as const }
  }
  const advice = result.data
  if (advice.needsVision === true && !local.requiresImageInput) {
    return { baseline, advised: null, assessment: 'missing-image' as const }
  }
  const advised = summarize(selectAdvisedRoute(config, {
    ...local,
    score: advice.difficulty,
    desiredEffort: config.effortByScore[advice.difficulty],
    estimatedUsage: { ...local.estimatedUsage, outputTokens: config.estimatedOutputTokensByScore[advice.difficulty] },
  }, options))
  return { baseline, advised, assessment: 'accepted' as const }
}
