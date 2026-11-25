import type { PriceConfig, QuotaConfig } from './config.js'

export const PICO_USD_PER_MICRO_USD = 1_000_000n
export const NANO_QUOTA_PER_MILLI_UNIT = 1_000_000n
export const NANO_QUOTA_PER_UNIT = 1_000_000_000n

export interface TokenUsage {
  inputTokens: number
  outputTokens: number
  cacheReadTokens?: number
  cacheWriteTokens?: number
  reasoningTokens?: number
  totalTokens?: number
}

export const ZERO_USAGE: Readonly<TokenUsage> = Object.freeze({ inputTokens: 0, outputTokens: 0 })

export function routeKey(provider: string, model: string): string {
  return `${provider}\0${model}`
}

export function routeLabel(provider: string, model: string): string {
  return `${provider}/${model}`
}

export function priceUsagePicoUsd(prices: PriceConfig, usage: TokenUsage): bigint {
  return BigInt(usage.inputTokens) * BigInt(prices.inputMicroUsdPerMillionTokens)
    + BigInt(usage.cacheReadTokens ?? 0) * BigInt(prices.cacheReadMicroUsdPerMillionTokens)
    + BigInt(usage.cacheWriteTokens ?? 0) * BigInt(prices.cacheWriteMicroUsdPerMillionTokens)
    + BigInt(usage.outputTokens) * BigInt(prices.outputMicroUsdPerMillionTokens)
}

export function priceUsage(prices: PriceConfig, usage: TokenUsage): bigint {
  return priceUsagePicoUsd(prices, usage) / PICO_USD_PER_MICRO_USD
}

export function quotaUsageNanoUnits(quota: QuotaConfig, usage: TokenUsage): bigint {
  const weightedTokens = BigInt(usage.inputTokens) * BigInt(quota.inputMilliUnitsPerMillionTokens)
    + BigInt(usage.cacheReadTokens ?? 0) * BigInt(quota.cacheReadMilliUnitsPerMillionTokens)
    + BigInt(usage.cacheWriteTokens ?? 0) * BigInt(quota.cacheWriteMilliUnitsPerMillionTokens)
    + BigInt(usage.outputTokens) * BigInt(quota.outputMilliUnitsPerMillionTokens)
  return BigInt(quota.requestMilliUnits) * NANO_QUOTA_PER_MILLI_UNIT + weightedTokens
}

export function quotaUsage(quota: QuotaConfig, usage: TokenUsage): bigint {
  return quotaUsageNanoUnits(quota, usage) / NANO_QUOTA_PER_MILLI_UNIT
}

export function addBigInt(left: string, right: bigint): string {
  return (BigInt(left) + right).toString()
}

export function ratioBasisPoints(numerator: bigint, denominator: bigint): number | null {
  if (denominator === 0n) return null
  return Number(numerator * 10_000n / denominator)
}
