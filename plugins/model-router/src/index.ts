import { resolve } from 'node:path'
import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-agent'
import type {} from '@deepseek-ai/dsh-app-boot'
import { brandString } from '@deepseek-ai/dsh-brand'
import type {} from '@deepseek-ai/dsh-commands'
import type {} from '@deepseek-ai/dsh-client-connection'
import { isAgentLoopRequest, type GenerateOptions, type ReasoningEffortId, type StreamChunk, type TokenUsage } from '@deepseek-ai/dsh-llm'
import type {} from '@deepseek-ai/dsh-session'
import { Config, type ModelConfig } from './config.js'
import { HealthProbeRunner } from './health.js'
import { MetricsStore, type RequestOutcome } from './metrics.js'
import { createUsageReport, formatUsageReport } from './report.js'
import { assessTask, describeDecision, selectRoute, type RouteDecision, type TaskInput } from './routing.js'
import { routeLabel } from './usage.js'

export { Config } from './config.js'
export type { Config as ModelRouterConfig, ModelConfig, SubscriptionConfig } from './config.js'
export { HealthProbeRunner } from './health.js'
export { MetricsStore, applyMeasurement, emptyMetricsState, metricsStateSchema } from './metrics.js'
export type { DailyBucket, MetricsState, RequestMeasurement, RouteHealth, RouteStats } from './metrics.js'
export { createUsageReport, formatUsageReport } from './report.js'
export { assessTask, currentWindowStart, describeDecision, nearestEffort, selectRoute } from './routing.js'
export type { RouteDecision, TaskAssessment, TaskInput } from './routing.js'
export {
  priceUsage,
  priceUsagePicoUsd,
  quotaUsage,
  quotaUsageNanoUnits,
  routeKey,
  routeLabel,
} from './usage.js'
export type { TokenUsage } from './usage.js'

export const name = 'model-router'
export const inject = ['llm', 'profileContext']

interface ObservedRoute {
  provider: string
  model: string
}

function taskInput(message: { content: readonly { type: string; text?: string; offloaded?: boolean }[] }): TaskInput {
  const text: string[] = []
  let imageCount = 0
  let fileCount = 0
  for (const block of message.content) {
    if (block.type === 'text' && block.text !== undefined) text.push(block.text)
    else if (block.type === 'image' && block.offloaded !== true) imageCount += 1
    else if (block.type === 'file') fileCount += 1
  }
  return { text: text.join('\n'), imageCount, fileCount }
}

function usageText(): string {
  return 'Use /model-route status, auto, off, preview <task>, report, good, or bad.'
}

async function validateModels(
  ctx: Context,
  config: Config,
  onUnavailable: (model: ModelConfig, code: string) => Promise<void>,
): Promise<{ available: ModelConfig[]; unavailable: ModelConfig[] }> {
  const available: ModelConfig[] = []
  const unavailable: ModelConfig[] = []
  for (const model of config.models) {
    const reasoningEfforts: ModelConfig['reasoningEfforts'] = []
    let unavailableCode = 'UNKNOWN'
    for (const effort of model.reasoningEfforts) {
      try {
        await ctx.llm.prepareCall({
          provider: model.provider,
          model: model.model,
          reasoningEffort: brandString<ReasoningEffortId>(effort),
        })
        reasoningEfforts.push(effort)
      } catch (error: unknown) {
        const observedCode = typeof error === 'object' && error !== null && 'code' in error && typeof error.code === 'string'
          ? error.code
          : undefined
        const code = observedCode !== undefined && /^[A-Za-z0-9_.:-]{1,64}$/u.test(observedCode) ? observedCode : 'UNKNOWN'
        unavailableCode = code
        ctx.logger.warn(`model-router: excluding ${routeLabel(model.provider, model.model)} at ${effort}; validation ${code}`)
      }
    }
    if (reasoningEfforts.length > 0) available.push({ ...model, reasoningEfforts })
    else {
      unavailable.push(model)
      await onUnavailable(model, unavailableCode)
    }
  }
  return { available, unavailable }
}

export async function apply(ctx: Context, config: Config): Promise<void> {
  const metrics = await MetricsStore.load(resolve(ctx.profileContext.dir, config.stateFile), config)
  const { available: availableModels, unavailable: unavailableModels } = await validateModels(ctx, config, async (model, code) => {
    await metrics.markUnavailable(model.provider, model.model, code, new Date())
  })
  const candidateModels = [...availableModels, ...unavailableModels]
  const routingConfig: Config = { ...config, models: candidateModels }
  new HealthProbeRunner(ctx, { ...config, models: candidateModels }, metrics).start()
  const automatic = new Map<string, boolean>()
  const lastDecisions = new Map<string, RouteDecision>()
  const lastObservedRoutes = new Map<string, ObservedRoute>()
  const activeSessions = new Set<string>()
  let routingEnabled = config.enabled

  const choose = (input: TaskInput): RouteDecision | undefined => {
    const now = new Date()
    const assessment = assessTask(routingConfig, input)
    const models = candidateModels.filter(model => metrics.isRoutable(model.provider, model.model, now))
    return selectRoute({ ...routingConfig, models }, assessment, metrics.quotaBySubscription(now))
  }

  ctx.on('agent/created', ({ agent }) => {
    activeSessions.add(agent.session.id)
    return undefined
  })

  ctx.on('agent/inbox/claimed', ({ agent, message }) => {
    activeSessions.add(agent.session.id)
    const source: { kind: string; assignment?: unknown; modelPinned?: unknown } = message.source
    if (!routingEnabled || automatic.get(agent.session.id) === false || !config.sourceKinds.includes(source.kind)) return
    if (source.kind === 'dsh-superagent' && (source.assignment !== true || source.modelPinned === true)) return
    let reservationId: string | undefined
    try {
      const decision = choose(taskInput(message))
      if (decision === undefined) {
        if (availableModels.length > 0) ctx.logger.warn('model-router: no available model fits the task; retaining the current route')
        return
      }
      reservationId = metrics.reserve(agent.session.id, decision, new Date())
      agent.model.select({
        provider: decision.model.provider,
        model: decision.model.model,
        reasoningEffort: brandString<ReasoningEffortId>(decision.reasoningEffort),
      })
      lastDecisions.set(agent.session.id, decision)
      ctx.logger.info(`model-router: ${describeDecision(decision)}`)
    } catch (error: unknown) {
      metrics.releaseReservation(reservationId)
      ctx.logger.warn('model-router: route selection failed; retaining the current route: %o', error)
    }
  })

  ctx.on('session/event', (session, event) => {
    if (event.type === 'step/end' || event.type === 'turn/end') metrics.releaseSessionReservations(session.id)
  })

  ctx.on('agent/disposed', ({ agent }) => {
    const sessionId = agent.session.id
    automatic.delete(sessionId)
    lastDecisions.delete(sessionId)
    lastObservedRoutes.delete(sessionId)
    activeSessions.delete(sessionId)
    metrics.releaseSessionReservations(sessionId)
  })

  ctx.on('llm/stream', (options: GenerateOptions, next): AsyncIterable<StreamChunk> => {
    const sessionId = options.sessionId
    if (!isAgentLoopRequest(options) || sessionId === undefined) return next()
    return measureStream(options, sessionId, next())
  })

  async function* measureStream(
    options: GenerateOptions,
    sessionId: NonNullable<GenerateOptions['sessionId']>,
    stream: AsyncIterable<StreamChunk>,
  ): AsyncGenerator<StreamChunk> {
    const startedAt = Date.now()
    const reservationId = metrics.claimReservation(sessionId, options.provider, options.model)
    let usage: TokenUsage | undefined
    let failureCode: string | undefined
    let outcome: RequestOutcome = options.signal?.aborted ? 'aborted' : 'failed'
    try {
      for await (const chunk of stream) {
        if (chunk.type === 'usage') usage = chunk.usage
        if (chunk.type === 'finish') {
          if (chunk.reason.kind === 'stop' || chunk.reason.kind === 'tool-calls') outcome = 'completed'
          else if (chunk.reason.kind === 'max-tokens') outcome = 'truncated'
          else if (chunk.reason.kind === 'aborted') outcome = 'aborted'
          else outcome = 'failed'
          if (chunk.reason.kind === 'error' || chunk.reason.kind === 'aborted') failureCode = chunk.reason.failure.code
        }
        yield chunk
      }
    } finally {
      const observed = { provider: options.provider, model: options.model }
      if (activeSessions.has(sessionId)) lastObservedRoutes.set(sessionId, observed)
      if (options.signal?.aborted && outcome === 'failed') outcome = 'aborted'
      try {
        await metrics.record({
          ...observed,
          ...(usage === undefined ? {} : { usage }),
          latencyMs: Date.now() - startedAt,
          outcome,
          ...(failureCode === undefined ? {} : { failureCode }),
          now: new Date(),
        }, reservationId)
      } catch (error: unknown) {
        ctx.logger.warn('model-router: usage persistence failed: %o', error)
      }
    }
  }

  const reportValue = () => ({
    ...createUsageReport(metrics.snapshot(), config, new Date(), metrics.persistenceError()),
    generatedAt: new Date().toISOString(),
    strategy: config.strategy,
    routingEnabled,
    activeProbes: config.models.filter(model => model.healthProbe)
      .map(model => routeLabel(model.provider, model.model)),
  })
  const registerDashboardRoutes = (connection: Context['connection']): void => {
    connection.fetch.register({
      path: '/api/model-router/report',
      methods: ['POST'],
      requestBody: 'buffered',
      fetch: async (request) => {
        try {
          request.signal.throwIfAborted()
          return Response.json(reportValue())
        } catch (error: unknown) {
          if (request.signal.aborted) throw error
          ctx.logger.warn('model-router: dashboard report failed: %o', error)
          return Response.json({ error: 'The model-router report is unavailable.' }, { status: 500 })
        }
      },
    })
    connection.fetch.register({
      path: '/api/model-router/set-routing',
      methods: ['POST'],
      requestBody: 'buffered',
      fetch: async (request) => {
        try {
          const payload: unknown = await request.json()
          if (typeof payload !== 'object' || payload === null || !('enabled' in payload) || typeof payload.enabled !== 'boolean') {
            return Response.json({ error: 'The enabled field must be a boolean.' }, { status: 400 })
          }
          routingEnabled = payload.enabled
          return Response.json({ enabled: routingEnabled })
        } catch {
          return Response.json({ error: 'The routing request is invalid.' }, { status: 400 })
        }
      },
    })
  }
  const existingConnection = ctx.get('connection')
  if (existingConnection !== undefined) registerDashboardRoutes(existingConnection)
  else ctx.inject(['connection'], scope => registerDashboardRoutes(scope.connection))

  ctx.inject(['commands'], (commandCtx) => {
    commandCtx.effect(() => commandCtx.commands.register({
      name: 'model-route',
      description: 'Inspect task routing and model cost/quota usage',
      input: { hint: 'status | auto | off | preview <task> | report | good | bad' },
      handler: async ({ agent, rawInput }) => {
        const input = rawInput.trim()
        const sessionId = agent.session.id
        if (input === 'auto') {
          automatic.set(sessionId, true)
          return { kind: 'success', text: 'Automatic routing is enabled for this session.' }
        }
        if (input === 'off') {
          automatic.set(sessionId, false)
          return { kind: 'success', text: 'Automatic routing is disabled for this session. The current model remains selected.' }
        }
        if (input === 'report') {
          return {
            kind: 'success',
            text: formatUsageReport(createUsageReport(metrics.snapshot(), config, new Date(), metrics.persistenceError())),
          }
        }
        if (input === 'good' || input === 'bad') {
          const route = lastObservedRoutes.get(sessionId)
          if (route === undefined) return { kind: 'error', text: 'No measured request is available to rate in this session.' }
          const rated = await metrics.rate(route.provider, route.model, input === 'good')
          return rated
            ? { kind: 'success', text: `Recorded ${input} feedback for ${routeLabel(route.provider, route.model)}.` }
            : { kind: 'error', text: 'The route has no stored metrics.' }
        }
        if (input.startsWith('preview ')) {
          const task = input.slice('preview '.length).trim()
          if (!task) return { kind: 'error', text: usageText() }
          const decision = choose({ text: task })
          return decision === undefined
            ? { kind: 'error', text: 'No available configured model fits this task.' }
            : { kind: 'success', text: describeDecision(decision) }
        }
        if (input === '' || input === 'status') {
          const current = agent.model.current()
          const last = lastDecisions.get(sessionId)
          const lines = [
            `Automatic routing: ${routingEnabled && automatic.get(sessionId) !== false ? 'on' : 'off'}; strategy: ${config.strategy}.`,
            `Current model: ${current === undefined ? 'none' : routeLabel(current.provider, current.model)}${current?.reasoningEffort === undefined ? '' : ` at ${current.reasoningEffort}`}.`,
          ]
          if (last !== undefined) lines.push(`Last task decision: ${describeDecision(last)}.`)
          if (config.models.length === 0) lines.push('No routes are configured; usage is measured without route changes or cost estimates.')
          else if (availableModels.length === 0) lines.push('No configured route passed DSH availability and reasoning-effort validation.')
          return { kind: 'success', text: lines.join('\n') }
        }
        return { kind: 'error', text: usageText() }
      },
    }), 'model-router: human command')
  })
}
