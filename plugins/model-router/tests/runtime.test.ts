import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { brandString } from '@deepseek-ai/dsh-brand'
import type { CommandDefinition, CommandInvocation, CommandResult } from '@deepseek-ai/dsh-commands'
import { markAgentLoopRequest, type StreamChunk } from '@deepseek-ai/dsh-llm'
import { apply, Config, MetricsStore } from '../src/index.js'

type Listener = (...args: never[]) => void | AsyncIterable<StreamChunk>

async function fixture() {
  const directory = await mkdtemp(join(tmpdir(), 'model-router-runtime-'))
  const listeners = new Map<string, Listener>()
  let commandHandler: CommandDefinition['handler'] | undefined
  const ctx = Object.assign(new Context(), {
    profileContext: { dir: directory },
    llm: {
      async prepareCall(selection: { provider: string }) {
        if (selection.provider === 'unavailable') throw new Error('no adapter')
        return {}
      },
    },
    logger: { info() {}, warn() {} },
    on(event: string, listener: Listener) {
      listeners.set(event, listener)
      return () => listeners.delete(event)
    },
    inject(_services: string[], callback: (context: Context) => void) { callback(commandContext) },
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
  const config = Config.parse({
    stateFile: 'metrics.json',
    strategy: 'quality',
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
  return { directory, listeners, selections, agent, invokeCommand }
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
