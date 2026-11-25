import type { Config, ModelConfig, ReasoningEffort, SubscriptionConfig } from './config.js'
import { REASONING_EFFORTS } from './config.js'
import {
  NANO_QUOTA_PER_MILLI_UNIT,
  priceUsagePicoUsd,
  quotaUsageNanoUnits,
  routeKey,
  routeLabel,
  type TokenUsage,
} from './usage.js'

export interface TaskInput {
  text: string
  imageCount?: number
  fileCount?: number
}

export interface TaskAssessment {
  score: number
  desiredEffort: ReasoningEffort
  reasons: string[]
  estimatedUsage: TokenUsage
  requiresImageInput: boolean
}

export interface RouteDecision {
  assessment: TaskAssessment
  model: ModelConfig
  reasoningEffort: ReasoningEffort
  estimatedCashPicoUsd: bigint
  estimatedEquivalentPicoUsd: bigint
  estimatedQuotaNanoUnits: bigint
  utility: number
}

interface Candidate extends RouteDecision {
  cashScore: number
  quotaScore: number
  qualityScore: number
  speedScore: number
}

export function assessTask(config: Config, input: TaskInput): TaskAssessment {
  const classification = config.classification
  let score = classification.baseScore
  const reasons = [`base ${classification.baseScore}`]
  const normalized = input.text.toLocaleLowerCase()
  for (const threshold of classification.lengthThresholds) {
    if (input.text.length >= threshold.characters) {
      score += threshold.weight
      reasons.push(`${input.text.length} characters +${threshold.weight}`)
    }
  }
  for (const signal of classification.signals) {
    if (signal.terms.some(term => normalized.includes(term.toLocaleLowerCase()))) {
      score += signal.weight
      reasons.push(`${signal.label} ${signal.weight >= 0 ? '+' : ''}${signal.weight}`)
    }
  }
  const attachmentCount = (input.imageCount ?? 0) + (input.fileCount ?? 0)
  if (attachmentCount > 0 && classification.attachmentWeight > 0) {
    score += classification.attachmentWeight
    reasons.push(`${attachmentCount} attachments +${classification.attachmentWeight}`)
  }
  score = Math.max(1, Math.min(5, score))
  const estimatedUsage: TokenUsage = {
    inputTokens: Math.max(1, Math.ceil(input.text.length / classification.charactersPerToken)),
    outputTokens: config.estimatedOutputTokensByScore[score as 1 | 2 | 3 | 4 | 5],
  }
  return {
    score,
    desiredEffort: config.effortByScore[score as 1 | 2 | 3 | 4 | 5],
    reasons,
    estimatedUsage,
    requiresImageInput: (input.imageCount ?? 0) > 0,
  }
}

export function nearestEffort(supported: readonly ReasoningEffort[], desired: ReasoningEffort): ReasoningEffort {
  const desiredIndex = REASONING_EFFORTS.indexOf(desired)
  return supported.reduce((best, candidate) => {
    const candidateIndex = REASONING_EFFORTS.indexOf(candidate)
    const bestIndex = REASONING_EFFORTS.indexOf(best)
    const distance = Math.abs(candidateIndex - desiredIndex)
    const bestDistance = Math.abs(bestIndex - desiredIndex)
    if (distance < bestDistance) return candidate
    if (distance === bestDistance && candidateIndex < bestIndex) return candidate
    return best
  }, supported[0] ?? desired)
}

function subscriptionWindowStart(subscription: SubscriptionConfig, now: Date): bigint {
  const windowMs = BigInt(subscription.windowHours * 60 * 60 * 1000)
  const anchorMs = BigInt(Date.parse(subscription.windowAnchor))
  const elapsed = BigInt(now.getTime()) - anchorMs
  const windows = elapsed >= 0n ? elapsed / windowMs : -((-elapsed + windowMs - 1n) / windowMs)
  return anchorMs + windows * windowMs
}

export function currentWindowStart(subscription: SubscriptionConfig, now: Date): string {
  return subscriptionWindowStart(subscription, now).toString()
}

function equivalentCostPicoUsd(
  model: ModelConfig,
  subscriptions: readonly SubscriptionConfig[],
  quotaNanoUnits: bigint,
): bigint {
  const billing = model.billing
  if (billing.kind === 'pay-as-you-go') return 0n
  const subscription = subscriptions.find(item => item.id === billing.subscription)
  if (subscription?.windowCostMicroUsd === undefined || subscription.quotaLimitMilliUnits === 0) return 0n
  return quotaNanoUnits * BigInt(subscription.windowCostMicroUsd) / BigInt(subscription.quotaLimitMilliUnits)
}

function percentage(value: bigint, maximum: bigint): number {
  if (maximum === 0n) return 100
  return Math.max(0, 100 - Number(value * 100n / maximum))
}

function candidateUtility(candidate: Candidate, config: Config): number {
  const weights = config.weights
  const weighted = BigInt(weights.quality) * BigInt(candidate.qualityScore)
    + BigInt(weights.speed) * BigInt(candidate.speedScore)
    + BigInt(weights.cash) * BigInt(candidate.cashScore)
    + BigInt(weights.quota) * BigInt(candidate.quotaScore)
  const total = BigInt(weights.quality) + BigInt(weights.speed) + BigInt(weights.cash) + BigInt(weights.quota)
  return Number((weighted + total / 2n) / total)
}

export function selectRoute(
  config: Config,
  assessment: TaskAssessment,
  quotaUsedNanoUnits: ReadonlyMap<string, bigint> = new Map(),
): RouteDecision | undefined {
  const prepared: Omit<Candidate, 'cashScore' | 'quotaScore' | 'qualityScore' | 'speedScore' | 'utility'>[] = []
  for (const model of config.models) {
    if (model.capability < assessment.score) continue
    if (assessment.estimatedUsage.inputTokens > (model.contextWindow ?? Number.MAX_SAFE_INTEGER)) continue
    if (assessment.requiresImageInput && !model.input.includes('image')) continue
    const billing = model.billing
    if (billing.kind === 'subscription') {
      const subscription = config.subscriptions.find(item => item.id === billing.subscription)
      if (subscription === undefined) continue
      const estimatedQuota = quotaUsageNanoUnits(billing.quota, assessment.estimatedUsage)
      const used = quotaUsedNanoUnits.get(subscription.id) ?? 0n
      const limit = BigInt(subscription.quotaLimitMilliUnits) * NANO_QUOTA_PER_MILLI_UNIT
      if (limit > 0n && used + estimatedQuota > limit) continue
      prepared.push({
        assessment,
        model,
        reasoningEffort: nearestEffort(model.reasoningEfforts, assessment.desiredEffort),
        estimatedCashPicoUsd: 0n,
        estimatedEquivalentPicoUsd: equivalentCostPicoUsd(model, config.subscriptions, estimatedQuota),
        estimatedQuotaNanoUnits: estimatedQuota,
      })
    } else {
      const cash = priceUsagePicoUsd(billing.prices, assessment.estimatedUsage)
      prepared.push({
        assessment,
        model,
        reasoningEffort: nearestEffort(model.reasoningEfforts, assessment.desiredEffort),
        estimatedCashPicoUsd: cash,
        estimatedEquivalentPicoUsd: cash,
        estimatedQuotaNanoUnits: 0n,
      })
    }
  }
  if (prepared.length === 0) return undefined
  const maximumCash = prepared.reduce((max, item) => item.estimatedEquivalentPicoUsd > max ? item.estimatedEquivalentPicoUsd : max, 0n)
  const maximumQuota = prepared.reduce((max, item) => item.estimatedQuotaNanoUnits > max ? item.estimatedQuotaNanoUnits : max, 0n)
  const maximumCapability = Math.max(...prepared.map(item => item.model.capability))
  const maximumSpeed = Math.max(...prepared.map(item => item.model.speed))
  const candidates: Candidate[] = prepared.map(item => ({
    ...item,
    cashScore: percentage(item.estimatedEquivalentPicoUsd, maximumCash),
    quotaScore: percentage(item.estimatedQuotaNanoUnits, maximumQuota),
    qualityScore: Math.round(item.model.capability * 100 / maximumCapability),
    speedScore: Math.round(item.model.speed * 100 / maximumSpeed),
    utility: 0,
  }))
  for (const candidate of candidates) candidate.utility = candidateUtility(candidate, config)
  candidates.sort((left, right) => {
    if (config.strategy === 'quality' && left.model.capability !== right.model.capability) return right.model.capability - left.model.capability
    if (config.strategy === 'speed' && left.model.speed !== right.model.speed) return right.model.speed - left.model.speed
    if (config.strategy === 'cash' && left.estimatedCashPicoUsd !== right.estimatedCashPicoUsd) {
      return left.estimatedCashPicoUsd < right.estimatedCashPicoUsd ? -1 : 1
    }
    if (config.strategy === 'subscription') {
      const leftSubscription = left.model.billing.kind === 'subscription'
      const rightSubscription = right.model.billing.kind === 'subscription'
      if (leftSubscription !== rightSubscription) return leftSubscription ? -1 : 1
      if (left.estimatedQuotaNanoUnits !== right.estimatedQuotaNanoUnits) {
        return left.estimatedQuotaNanoUnits < right.estimatedQuotaNanoUnits ? -1 : 1
      }
    }
    if (left.utility !== right.utility) return right.utility - left.utility
    return routeKey(left.model.provider, left.model.model).localeCompare(routeKey(right.model.provider, right.model.model))
  })
  return candidates[0]
}

export function describeDecision(decision: RouteDecision): string {
  return `${routeLabel(decision.model.provider, decision.model.model)} at ${decision.reasoningEffort}; `
    + `task ${decision.assessment.score}/5 (${decision.assessment.reasons.join(', ')}); utility ${decision.utility}/100`
}
