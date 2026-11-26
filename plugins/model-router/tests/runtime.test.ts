import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { brandString } from '@deepseek-ai/dsh-brand'
import type { CommandDefinition, CommandInvocation, CommandResult } from '@deepseek-ai/dsh-commands'
import { markAgentLoopRequest, type StreamChunk } from '@deepseek-ai/dsh-llm'
import { apply, Config, MetricsStore } from '../src/index.js'

type Listener = (...args: never[]) => void | AsyncIterable<StreamChunk>
type FetchRouteHandler = (request: Request) => Promise<Response>

async function fixture(unsupportedEffort?: string, retryAfterMs = 60000) {
  const directory = await mkdtemp(join(tmpdir(), 'model-router-runtime-'))
  const listeners = new Map<string, Listener>()
  const rpcHandlers = new Map<string, FetchRouteHandler>()
  const warnings: string[] = []
  let commandHandler: CommandDefinition['handler'] | undefined
  const ctx = Object.assign(new Context(), {
    profileContext: { dir: directory },
    llm: {
      async prepareCall(selection: { provider: string; reasoningEffort?: string }) {
        if (selection.provider === 'unavailable' || selection.reasoningEffort === unsupportedEffort) throw new Error('secret provider detail')
        return {}
      },
    },
    logger: { info() {}, warn(...args: unknown[]) { warnings.push(args.map(String).join(' ')) } },
    on(event: string, listener: Listener) {
      listeners.set(event, listener)
      return () => listeners.delete(event)
    },
    inject(services: string[], callback: (context: Context) => void) {
      callback(services.includes('connection') ? rpcContext : commandContext)
    },
  })
  const commandContext = Object.assign(new Context(), {
    commands: {
      register(definition: CommandDefinition) {
        commandHandler = definition.handler
        return () => { commandHandler = undefined }
      },
    },
    effect(callback: () => () => void) { return callback() },
  })
  const rpcContext = Object.assign(new Context(), {
    connection: {
      fetch: {
        register(route: { path: string; fetch: FetchRouteHandler }) {
          rpcHandlers.set(route.path, route.fetch)
          return async () => { rpcHandlers.delete(route.path) }
        },
      },
    },
  })
  const config = Config.parse({
    stateFile: 'metrics.json',
    strategy: 'quality',
    health: { retryAfterMs },
    subscriptions: [{
      id: 'plan', windowHours: 5, windowAnchor: '2026-11-25T10:00:00.000Z', quotaLimitMilliUnits: 1500,
    }],
    models: [{
      provider: 'selected', model: 'heavy', capability: 5, speed: 3,
      reasoningEfforts: ['off', 'low', 'high', 'max'],
      billing: {
        kind: 'subscription',
        subscription: 'plan',
        quota: {
          requestMilliUnits: 600,
          inputMilliUnitsPerMillionTokens: 0,
          cacheReadMilliUnitsPerMillionTokens: 0,
          cacheWriteMilliUnitsPerMillionTokens: 0,
          outputMilliUnitsPerMillionTokens: 0,
        },
      },
    }, {
      provider: 'unavailable', model: 'invalid', capability: 5, speed: 5,
      reasoningEfforts: ['off', 'low', 'high', 'max'],
      billing: {
        kind: 'pay-as-you-go',
        prices: {
          inputMicroUsdPerMillionTokens: 1,
          cacheReadMicroUsdPerMillionTokens: 1,
          cacheWriteMicroUsdPerMillionTokens: 1,
          outputMicroUsdPerMillionTokens: 1,
        },
      },
    }],
  })
  await apply(ctx, config)
  const selections: { provider: string; model: string; reasoningEffort?: string }[] = []
  const agent = {
    session: { id: 'session-1' },
    model: {
      select(selection: { provider: string; model: string; reasoningEffort?: string }) { selections.push(selection) },
      current() { return selections.at(-1) },
    },
  } as Agent
  const invokeCommand = async (rawInput: string): Promise<CommandResult> => {
    assert.ok(commandHandler)
    return await commandHandler({ agent, rawInput } as CommandInvocation)
  }
  return { directory, listeners, rpcHandlers, selections, agent, invokeCommand, warnings }
}

describe('mounted plugin behavior', () => {
  it('given_a_heavy_inbox_task_when_inserted_then_selects_route_before_the_step', async () => {
    const { listeners, selections, agent } = await fixture()
    const inserted = listeners.get('agent/inbox/claimed')
    assert.ok(inserted)
    inserted({
      agent,
      message: { source: { kind: 'user' }, content: [{ type: 'text', text: 'Implement and test a system-wide security refactor' }] },
    } as never)
    assert.deepEqual(selections, [{ provider: 'selected', model: 'heavy', reasoningEffort: 'high' }])
  })

  it('given_raw_validation_errors_when_logged_then_only_structured_codes_are_emitted', async () => {
    const { warnings } = await fixture()
    assert.ok(warnings.some(line => line.includes('validation UNKNOWN')))
    assert.doesNotMatch(warnings.join('\n'), /secret provider detail/u)
  })

  it('given_partial_reasoning_support_when_validated_then_model_health_is_not_marked_unavailable', async () => {
    const { rpcHandlers } = await fixture('max')
    const reportRoute = rpcHandlers.get('/api/model-router/report')
    assert.ok(reportRoute)
    const response = await reportRoute(new Request('http://localhost/api/model-router/report', { method: 'POST', body: 'null' }))
    const report = await response.json() as { routes: { model: string; health: { status: string } }[] }
    assert.equal(report.routes.find(route => route.model === 'heavy')?.health.status, 'unknown')
    assert.equal(report.routes.find(route => route.model === 'invalid')?.health.status, 'unhealthy')
  })

  it('given_startup_invalid_route_after_retry_cooldown_when_claimed_then_route_can_be_retried', async () => {
    const { directory, listeners, selections, agent } = await fixture()
    const claimed = listeners.get('agent/inbox/claimed')
    assert.ok(claimed)
    const message = { source: { kind: 'user' }, content: [{ type: 'text', text: 'Implement a security refactor' }] }
    claimed({ agent, message } as never)
    assert.equal(selections[0]?.provider, 'selected')
    const path = join(directory, 'metrics.json')
    const state = JSON.parse(await readFile(path, 'utf8')) as {
      health: Record<string, { lastFailureAt?: string; lastSeenAt?: string }>
    }
    const failedAt = new Date(Date.now() - 60001).toISOString()
    if (state.health['unavailable\0invalid'] !== undefined) {
      state.health['unavailable\0invalid'].lastFailureAt = failedAt
      state.health['unavailable\0invalid'].lastSeenAt = failedAt
    }
    await writeFile(path, JSON.stringify(state))
    claimed({ agent, message } as never)
    assert.equal(selections[1]?.provider, 'unavailable')
  })

  it('given_an_offloaded_image_when_claimed_then_a_text_only_route_remains_eligible', async () => {
    const { listeners, selections, agent } = await fixture()
    const claimed = listeners.get('agent/inbox/claimed')
    assert.ok(claimed)
    claimed({
      agent,
      message: {
        source: { kind: 'user' },
        content: [{ type: 'text', text: 'Diagnose this image' }, { type: 'image', offloaded: true }],
      },
    } as never)
    assert.equal(selections[0]?.provider, 'selected')
  })

  it('given_routing_disabled_by_command_when_a_task_arrives_then_selection_is_unchanged', async () => {
    const { listeners, selections, agent, invokeCommand } = await fixture()
    assert.equal((await invokeCommand('off')).kind, 'success')
    const inserted = listeners.get('agent/inbox/claimed')
    assert.ok(inserted)
    inserted({ agent, message: { source: { kind: 'user' }, content: [{ type: 'text', text: 'Implement a security refactor' }] } } as never)
    assert.deepEqual(selections, [])
  })

  it('given_an_agent_disposal_when_status_is_read_then_session_decision_state_is_gone', async () => {
    const { listeners, agent, invokeCommand } = await fixture()
    const inserted = listeners.get('agent/inbox/claimed')
    const disposed = listeners.get('agent/disposed')
    assert.ok(inserted)
    assert.ok(disposed)
    inserted({ agent, message: { source: { kind: 'user' }, content: [{ type: 'text', text: 'Implement a security refactor' }] } } as never)
    const before = await invokeCommand('status')
    assert.match(before.text ?? '', /Last task decision/u)
    disposed({ agent } as never)
    const after = await invokeCommand('status')
    assert.doesNotMatch(after.text ?? '', /Last task decision/u)
  })

  it('given_rejected_claims_when_turns_end_then_unused_reservations_are_released', async () => {
    const { listeners, selections, agent } = await fixture()
    const claimed = listeners.get('agent/inbox/claimed')
    const sessionEvent = listeners.get('session/event')
    assert.ok(claimed)
    assert.ok(sessionEvent)
    const message = { source: { kind: 'user' }, content: [{ type: 'text', text: 'Implement a security refactor' }] }
    for (let index = 0; index < 3; index += 1) {
      claimed({ agent, message } as never)
      if (index < 2) sessionEvent(agent.session as never, { type: 'turn/end' } as never)
    }
    assert.equal(selections.length, 3)
  })

  it('given_dashboard_routes_when_registered_then_they_use_owner_checked_connection_paths', async () => {
    const { rpcHandlers } = await fixture()
    assert.ok(rpcHandlers.has('/api/model-router/report'))
    assert.ok(rpcHandlers.has('/api/model-router/set-routing'))
  })

  it('given_owner_fetch_when_pausing_and_resuming_then_claimed_tasks_follow_the_live_state', async () => {
    const { listeners, rpcHandlers, selections, agent } = await fixture()
    const setRouting = rpcHandlers.get('/api/model-router/set-routing')
    const reportRoute = rpcHandlers.get('/api/model-router/report')
    const claimed = listeners.get('agent/inbox/claimed')
    assert.ok(setRouting)
    assert.ok(reportRoute)
    assert.ok(claimed)
    const routingRequest = (enabled: unknown) => new Request('http://localhost/api/model-router/set-routing', {
      method: 'POST', body: JSON.stringify({ enabled }),
    })
    const paused = await setRouting(routingRequest(false))
    assert.equal(paused.status, 200)
    const message = { source: { kind: 'user' }, content: [{ type: 'text', text: 'Implement a security refactor' }] }
    claimed({ agent, message } as never)
    assert.equal(selections.length, 0)
    const reportResponse = await reportRoute(new Request('http://localhost/api/model-router/report', { method: 'POST', body: 'null' }))
    const report = await reportResponse.json() as {
      routingEnabled: boolean
      routes: { health: { status: string } }[]
    }
    assert.equal(report.routingEnabled, false)
    assert.ok(report.routes.some(route => route.health.status === 'unhealthy'))
    await setRouting(routingRequest(true))
    claimed({ agent, message } as never)
    assert.equal(selections.length, 1)
    const invalid = await setRouting(routingRequest('yes'))
    assert.equal(invalid.status, 400)
  })

  it('given_late_cancellation_without_finish_when_stream_settles_then_health_does_not_degrade', async () => {
    const { directory, listeners } = await fixture()
    const streamListener = listeners.get('llm/stream')
    assert.ok(streamListener)
    const controller = new AbortController()
    const options = markAgentLoopRequest({
      provider: 'selected', model: 'heavy', messages: [],
      sessionId: brandString<Agent['session']['id']>('session-1'), signal: controller.signal,
    })
    async function* response(): AsyncGenerator<StreamChunk> {
      yield { type: 'usage', usage: { inputTokens: 12, outputTokens: 3 } }
      controller.abort()
      throw new Error('cancelled transport')
    }
    const wrapped = streamListener(options as never, response as never)
    assert.ok(typeof wrapped === 'object' && Symbol.asyncIterator in wrapped)
    await assert.rejects(async () => { for await (const _chunk of wrapped) {} }, /cancelled transport/u)
    const metrics = await MetricsStore.load(join(directory, 'metrics.json'), Config.parse({}))
    assert.equal(metrics.snapshot().routes['selected\0heavy']?.aborted, 1)
    assert.equal(metrics.snapshot().routes['selected\0heavy']?.failed, 0)
    assert.equal(metrics.snapshot().health['selected\0heavy']?.consecutiveFailures, 0)
  })

  it('given_an_agent_loop_stream_when_drained_then_usage_and_outcome_are_persisted', async () => {
    const { directory, listeners } = await fixture()
    const streamListener = listeners.get('llm/stream')
    assert.ok(streamListener)
    const options = markAgentLoopRequest({
      provider: 'selected', model: 'heavy', messages: [], sessionId: brandString<Agent['session']['id']>('session-1'),
    })
    async function* response(): AsyncGenerator<StreamChunk> {
      yield { type: 'usage', usage: { inputTokens: 12, outputTokens: 3 } }
      yield { type: 'finish', reason: { kind: 'stop' } }
    }
    const wrapped = streamListener(options as never, response as never)
    assert.ok(typeof wrapped === 'object' && Symbol.asyncIterator in wrapped)
    for await (const _chunk of wrapped) {}
    const metrics = await MetricsStore.load(join(directory, 'metrics.json'), Config.parse({}))
    assert.equal(metrics.snapshot().routes['selected\0heavy']?.completed, 1)
    assert.equal(metrics.snapshot().routes['selected\0heavy']?.tokens.input, '12')
  })

  it('given_disposal_during_a_stream_when_it_finishes_then_feedback_state_is_not_reintroduced', async () => {
    const { listeners, agent, invokeCommand } = await fixture()
    const claimed = listeners.get('agent/inbox/claimed')
    const disposed = listeners.get('agent/disposed')
    const streamListener = listeners.get('llm/stream')
    assert.ok(claimed)
    assert.ok(disposed)
    assert.ok(streamListener)
    claimed({ agent, message: { source: { kind: 'user' }, content: [{ type: 'text', text: 'Implement a security refactor' }] } } as never)
    const options = markAgentLoopRequest({
      provider: 'selected', model: 'heavy', messages: [], sessionId: brandString<Agent['session']['id']>('session-1'),
    })
    const entered = Promise.withResolvers<void>()
    const finish = Promise.withResolvers<void>()
    async function* response(): AsyncGenerator<StreamChunk> {
      yield { type: 'usage', usage: { inputTokens: 12, outputTokens: 3 } }
      entered.resolve()
      await finish.promise
      yield { type: 'finish', reason: { kind: 'stop' } }
    }
    const wrapped = streamListener(options as never, response as never)
    assert.ok(typeof wrapped === 'object' && Symbol.asyncIterator in wrapped)
    const draining = (async () => { for await (const _chunk of wrapped) {} })()
    await entered.promise
    disposed({ agent } as never)
    finish.resolve()
    await draining
    assert.equal((await invokeCommand('good')).kind, 'error')
  })
})
