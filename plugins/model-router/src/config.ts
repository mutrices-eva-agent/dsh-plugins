import { z } from 'zod'

export const REASONING_EFFORTS = ['off', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max'] as const

const nonNegativeInteger = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER)
const score = z.number().int().min(1).max(5)
const effort = z.enum(REASONING_EFFORTS)

const priceSchema = z.object({
  inputMicroUsdPerMillionTokens: nonNegativeInteger,
  cacheReadMicroUsdPerMillionTokens: nonNegativeInteger,
  cacheWriteMicroUsdPerMillionTokens: nonNegativeInteger,
  outputMicroUsdPerMillionTokens: nonNegativeInteger,
}).strict()

const quotaSchema = z.object({
  requestMilliUnits: nonNegativeInteger.default(0),
  inputMilliUnitsPerMillionTokens: nonNegativeInteger.default(0),
  cacheReadMilliUnitsPerMillionTokens: nonNegativeInteger.default(0),
  cacheWriteMilliUnitsPerMillionTokens: nonNegativeInteger.default(0),
  outputMilliUnitsPerMillionTokens: nonNegativeInteger.default(0),
}).strict()

const billingSchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('pay-as-you-go'),
    prices: priceSchema,
  }).strict(),
  z.object({
    kind: z.literal('subscription'),
    subscription: z.string().min(1),
    quota: quotaSchema,
  }).strict(),
])

const modelSchema = z.object({
  provider: z.string().min(1),
  model: z.string().min(1),
  capability: score,
  speed: score,
  input: z.array(z.enum(['text', 'image'])).min(1).default(['text']),
  reasoningEfforts: z.array(effort).min(1).default([...REASONING_EFFORTS]),
  contextWindow: z.number().int().positive().max(Number.MAX_SAFE_INTEGER).optional(),
  billing: billingSchema,
}).strict()

const subscriptionSchema = z.object({
  id: z.string().min(1),
  windowHours: z.number().int().positive().max(8760),
  windowAnchor: z.string().refine(value => Number.isFinite(Date.parse(value)), 'must be an ISO date-time'),
  quotaLimitMilliUnits: nonNegativeInteger,
  windowCostMicroUsd: nonNegativeInteger.optional(),
}).strict()

const signalSchema = z.object({
  label: z.string().min(1),
  terms: z.array(z.string().min(1)).min(1),
  weight: z.number().int().min(-4).max(4),
}).strict()

const lengthThresholdSchema = z.object({
  characters: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
  weight: z.number().int().min(1).max(4),
}).strict()

export const Config = z.object({
  enabled: z.boolean().default(true),
  strategy: z.enum(['balanced', 'cash', 'subscription', 'quality', 'speed']).default('balanced'),
  sourceKinds: z.array(z.string().min(1)).min(1).default(['user']),
  stateFile: z.string().min(1).default('.model-router/metrics-v2.json'),
  lockWaitMs: z.number().int().positive().max(120000).default(5000),
  models: z.array(modelSchema).default([]),
  subscriptions: z.array(subscriptionSchema).default([]),
  weights: z.object({
    quality: nonNegativeInteger.default(35),
    speed: nonNegativeInteger.default(20),
    cash: nonNegativeInteger.default(25),
    quota: nonNegativeInteger.default(20),
  }).strict().prefault({}),
  classification: z.object({
    baseScore: score.default(1),
    attachmentWeight: z.number().int().min(0).max(4).default(1),
    charactersPerToken: z.number().int().positive().max(100).default(4),
    lengthThresholds: z.array(lengthThresholdSchema).default([
      { characters: 500, weight: 1 },
      { characters: 2000, weight: 1 },
      { characters: 8000, weight: 1 },
    ]),
    signals: z.array(signalSchema).default([
      {
        label: 'system design or code changes',
        terms: ['architecture', 'refactor', 'migration', 'concurrency', 'security', 'distributed', 'system-wide'],
        weight: 2,
      },
      {
        label: 'implementation or investigation',
        terms: ['implement', 'build', 'fix', 'debug', 'diagnose', 'optimize', 'test', 'deploy'],
        weight: 1,
      },
      {
        label: 'bounded wording or explanation',
        terms: ['typo', 'rename', 'explain', 'summarize', 'what is', 'format'],
        weight: -1,
      },
    ]),
  }).strict().prefault({}),
  effortByScore: z.object({
    1: effort.default('off'),
    2: effort.default('low'),
    3: effort.default('high'),
    4: effort.default('high'),
    5: effort.default('max'),
  }).strict().prefault({}),
  estimatedOutputTokensByScore: z.object({
    1: nonNegativeInteger.default(200),
    2: nonNegativeInteger.default(600),
    3: nonNegativeInteger.default(1500),
    4: nonNegativeInteger.default(3000),
    5: nonNegativeInteger.default(6000),
  }).strict().prefault({}),
}).strict().superRefine((config, context) => {
  const routeIds = new Set<string>()
  for (const [index, model] of config.models.entries()) {
    const id = `${model.provider}\0${model.model}`
    if (routeIds.has(id)) context.addIssue({ code: 'custom', message: 'duplicate provider/model route', path: ['models', index] })
    routeIds.add(id)
  }
  const subscriptionIds = new Set<string>()
  for (const [index, subscription] of config.subscriptions.entries()) {
    if (subscriptionIds.has(subscription.id)) context.addIssue({ code: 'custom', message: 'duplicate subscription id', path: ['subscriptions', index] })
    subscriptionIds.add(subscription.id)
  }
  for (const [index, model] of config.models.entries()) {
    if (model.billing.kind === 'subscription' && !subscriptionIds.has(model.billing.subscription)) {
      context.addIssue({
        code: 'custom',
        message: `unknown subscription "${model.billing.subscription}"`,
        path: ['models', index, 'billing', 'subscription'],
      })
    }
  }
  if (Object.values(config.weights).every(weight => weight === 0)) {
    context.addIssue({ code: 'custom', message: 'at least one routing weight must be positive', path: ['weights'] })
  }
}).prefault({})

export type Config = z.infer<typeof Config>
export type ModelConfig = Config['models'][number]
export type SubscriptionConfig = Config['subscriptions'][number]
export type PriceConfig = Extract<ModelConfig['billing'], { kind: 'pay-as-you-go' }>['prices']
export type QuotaConfig = Extract<ModelConfig['billing'], { kind: 'subscription' }>['quota']
export type ReasoningEffort = (typeof REASONING_EFFORTS)[number]
