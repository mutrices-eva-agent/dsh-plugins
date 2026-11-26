import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import vm from 'node:vm'

async function clientPlugin(rpcResult: { ok: boolean; value?: unknown; error?: { message: string } } = { ok: true, value: { routes: [] } }) {
  let definition: {
    id: string
    factory: (require: (id: string) => unknown) => {
      inject: string[]
      apply: (ctx: object) => void
    }
  }
  const window = {
    __ModuleLoader__: {
      load(value: typeof definition) { definition = value },
    },
  }
  const source = await readFile(new URL('../client.js', import.meta.url), 'utf8')
  const calls: { url: string; method: string; payload: unknown; signal?: AbortSignal }[] = []
  const fetch = async (url: string, options: { method: string; body: string; signal?: AbortSignal }) => {
    calls.push({ url, method: options.method, payload: options.body, ...(options.signal === undefined ? {} : { signal: options.signal }) })
    return {
      ok: rpcResult.ok,
      async json() { return rpcResult.ok ? rpcResult.value : { error: rpcResult.error?.message } },
    }
  }
  vm.runInNewContext(source, { window, fetch })
  const React = {
    Fragment: 'fragment',
    createElement: (type: unknown, props: unknown, ...children: unknown[]) => ({ type, props, children }),
    useCallback: <T>(callback: T) => callback,
    useEffect() {},
    useRef: <T>(value: T) => ({ current: value }),
    useState: <T>(value: T) => [value, () => undefined],
  }
  const plugin = definition!.factory((id: string) => {
    assert.equal(id, 'react')
    return React
  })
  const slots: {
    slot: string
    definition: { key?: string; id?: string }
    component: unknown
    injected?: {
      load: (signal: AbortSignal) => Promise<unknown>
      setRouting: (enabled: boolean, signal?: AbortSignal) => Promise<void>
    }
  }[] = []
  const ctx = {
    locale: {
      register() { return () => undefined },
      bind() { return (key: string) => key },
    },
    slots: {
      inject(slot: string, register: () => unknown) { return register() },
      register(definition: {
        name: string
        key?: string
        id?: string
        inject?: () => { load: (signal: AbortSignal) => Promise<unknown>; setRouting: (enabled: boolean, signal?: AbortSignal) => Promise<void> }
      }, component: unknown) {
        slots.push({ slot: definition.name, definition, component, ...(definition.inject === undefined ? {} : { injected: definition.inject() }) })
        return () => undefined
      },
    },
    effect(callback: () => unknown) { return callback() },
  }
  plugin.apply(ctx)
  return { plugin, slots, calls }
}

describe('dashboard client bundle', () => {
  it('given_dsh_loader_when_bundle_loads_then_registers_matching_page_and_sidebar_entries', async () => {
    const { plugin, slots } = await clientPlugin()
    assert.deepEqual(Array.from(plugin.inject), ['slots', 'connection', 'locale'])
    assert.equal(slots.find(slot => slot.slot === 'main')?.definition.key, 'model-router')
    assert.equal(slots.find(slot => slot.slot === 'sidebar.panellist')?.definition.id, 'model-router')
  })

  it('given_authenticated_fetch_success_when_client_loads_then_returns_report_and_sends_routing_updates', async () => {
    const { slots, calls } = await clientPlugin()
    const injected = slots.find(slot => slot.slot === 'main')?.injected
    assert.ok(injected)
    const report = await injected.load(new AbortController().signal)
    assert.deepEqual(report, { routes: [] })
    const mutation = new AbortController()
    await injected.setRouting(false, mutation.signal)
    assert.equal(calls.length, 2)
    assert.equal(calls[0]?.url, '/api/model-router/report')
    assert.equal(calls[0]?.method, 'POST')
    assert.equal(calls[0]?.payload, 'null')
    assert.equal(calls[1]?.url, '/api/model-router/set-routing')
    assert.equal(calls[1]?.method, 'POST')
    assert.equal(JSON.parse(String(calls[1]?.payload)).enabled, false)
    assert.equal(calls[1]?.signal, mutation.signal)
  })

  it('given_fetch_error_when_client_loads_then_surfaces_the_error', async () => {
    const { slots } = await clientPlugin({ ok: false, error: { message: 'denied' } })
    const injected = slots.find(slot => slot.slot === 'main')?.injected
    assert.ok(injected)
    await assert.rejects(injected.load(new AbortController().signal), /denied/u)
  })
})
