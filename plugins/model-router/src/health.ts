import type { Context } from '@deepseek-ai/cordis'
import { brandString } from '@deepseek-ai/dsh-brand'
import type { GenerateOptions, ReasoningEffortId, StreamChunk, TokenUsage } from '@deepseek-ai/dsh-llm'
import type { Config, ModelConfig } from './config.js'
import type { MetricsStore, RequestOutcome } from './metrics.js'
import { routeKey } from './usage.js'

declare module '@deepseek-ai/dsh-llm/types' {
  interface LlmRequestPurposeMap {
    'model-router-health': true
  }
}

function errorCode(error: unknown): string {
  if (typeof error === 'object' && error !== null && 'code' in error) {
    const code = error.code
    if (typeof code === 'string' && /^[A-Za-z0-9_.:-]{1,64}$/u.test(code)) return code
  }
  return 'UNKNOWN'
}

export class HealthProbeRunner {
  private readonly lastStarted = new Map<string, number>()
  private readonly running = new Map<string, Promise<void>>()
  private readonly controllers = new Map<string, AbortController>()
  private stopped = false

  constructor(
    private readonly ctx: Context,
    private readonly config: Config,
    private readonly metrics: MetricsStore,
  ) {}

  start(): void {
    if (!this.config.models.some(model => model.healthProbe)) return
    this.ctx.effect(() => {
      const timer = setInterval(() => this.tick(), this.config.health.probeIntervalMs)
      this.tick()
      return async () => {
        this.stopped = true
        clearInterval(timer)
        for (const controller of this.controllers.values()) controller.abort()
        await Promise.allSettled(this.running.values())
      }
    }, 'model-router: active health probes')
  }

  async whenIdle(): Promise<void> {
    await Promise.all(this.running.values())
  }

  private tick(): void {
    if (this.stopped) return
    const now = Date.now()
    for (const model of this.config.models) {
      if (!model.healthProbe) continue
      const key = routeKey(model.provider, model.model)
      if (this.running.has(key)) continue
      if (!this.metrics.isRoutable(model.provider, model.model, new Date(now))) continue
      if ((this.lastStarted.get(key) ?? -Infinity) + this.config.health.probeIntervalMs > now) continue
      this.lastStarted.set(key, now)
      const controller = new AbortController()
      this.controllers.set(key, controller)
      const promise = this.probe(model, controller).catch((error: unknown) => {
        this.ctx.logger.warn(`model-router: health probe ${model.provider}/${model.model} failed with ${errorCode(error)}`)
      }).finally(() => {
        this.controllers.delete(key)
        this.running.delete(key)
      })
      this.running.set(key, promise)
    }
  }

  private async probe(model: ModelConfig, controller: AbortController): Promise<void> {
    const startedAt = Date.now()
    let usage: TokenUsage | undefined
    let outcome: RequestOutcome = 'failed'
    let code: string | undefined
    let timedOut = false
    const timeout = setTimeout(() => {
      timedOut = true
      controller.abort()
    }, this.config.health.probeTimeoutMs)
    try {
      const options: GenerateOptions<'model-router-health'> = {
        provider: model.provider,
        model: model.model,
        messages: [{ role: 'user', content: [{ type: 'text', text: 'Reply with OK.' }] }],
        maxTokens: this.config.health.probeMaxOutputTokens,
        purpose: 'model-router-health',
        signal: controller.signal,
        ...(model.reasoningEfforts.includes('off')
          ? { reasoningEffort: brandString<ReasoningEffortId>('off') }
          : {}),
      }
      for await (const chunk of this.ctx.llm.stream(options)) {
        if (chunk.type === 'usage') usage = chunk.usage
        if (chunk.type === 'finish') {
          outcome = finishOutcome(chunk)
          if (chunk.reason.kind === 'error' || chunk.reason.kind === 'aborted') code = chunk.reason.failure.code
        }
      }
      if (controller.signal.aborted) outcome = 'aborted'
    } catch (error: unknown) {
      code = errorCode(error)
      outcome = controller.signal.aborted ? 'aborted' : 'failed'
    } finally {
      clearTimeout(timeout)
    }
    if (timedOut) {
      code = 'TIMEOUT'
      outcome = 'failed'
    }
    if (!this.stopped || usage !== undefined) {
      await this.metrics.record({
        provider: model.provider,
        model: model.model,
        ...(usage === undefined ? {} : { usage }),
        latencyMs: Date.now() - startedAt,
        outcome,
        probe: true,
        ...(code === undefined ? {} : { failureCode: code }),
        now: new Date(),
      })
    }
  }
}

function finishOutcome(chunk: Extract<StreamChunk, { type: 'finish' }>): RequestOutcome {
  if (chunk.reason.kind === 'stop' || chunk.reason.kind === 'tool-calls') return 'completed'
  if (chunk.reason.kind === 'max-tokens') return 'truncated'
  if (chunk.reason.kind === 'aborted') return 'aborted'
  return 'failed'
}
