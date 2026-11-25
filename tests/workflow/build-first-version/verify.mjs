import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'

const required = [
  'AGENTS.md',
  '.agents/skills/autopilot/SKILL.md',
  '.agents/skills/autopilot/agents/openai.yaml',
  '.agents/skills/autopilot/references/ticket-loop.md',
  '.agents/skills/autopilot/references/delivery.md',
  'docs/agents/build-first-version.md',
  'tests/workflow/build-first-version/cases.md',
]
for (const path of required) assert.ok(existsSync(path), `${path} must exist`)

const skill = readFileSync(required[1], 'utf8')
assert.match(skill, /^name: autopilot$/mu)
assert.match(skill, /Use only when the user explicitly selects this workflow/u)
assert.match(skill, /independent review of every ticket/u)
assert.match(skill, /draft PR/u)

const metadata = readFileSync(required[2], 'utf8')
assert.match(metadata, /allow_implicit_invocation: false/u)

const root = readFileSync('AGENTS.md', 'utf8')
assert.match(root, /\.agents\/skills\/autopilot\/SKILL\.md/u)
assert.match(root, /docs\/agents\/build-first-version\.md/u)
assert.match(root, /does not activate a product-delivery run/u)

const adapter = readFileSync(required[5], 'utf8')
assert.match(adapter, /# Autopilot: DSH Plugins Adapter/u)
assert.match(adapter, /independent read-only critic/u)
assert.match(adapter, /paid probes/u)
assert.doesNotMatch(adapter, /Eva|eva_backend|frontend-bindgen/u)

const cases = readFileSync(required[6], 'utf8')
assert.match(cases, /given_clean_codex_profile_when_opening_dsh_plugins_then_autopilot_is_discoverable/u)
assert.doesNotMatch(cases, /Eva checkout|actual Eva adapter/u)

console.log('Autopilot workflow structure and explicit-invocation checks passed.')
