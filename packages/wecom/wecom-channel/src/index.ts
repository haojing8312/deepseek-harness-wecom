/**
 * WeCom channel driver (host plane). Wires an adapter's inbound messages to
 * per-external-chat Harness agents composed from the restricted `customer`
 * preset, and publishes the {@link WecomChannelService} the preset-mounted
 * `wecom.reply` / `wecom.knowledge.search` tools consume.
 * @module @deepseek-ai/dsh-wecom-channel
 */

import { randomUUID } from 'node:crypto'
import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import { SessionId } from '@deepseek-ai/dsh-session'
// Type-only: brings the `ctx.agentPresets` Context augmentation into scope.
import type {} from '@deepseek-ai/dsh-agent-presets'
import type { WecomChannelService, WecomInboundMessage } from './types.ts'

export const name = 'wecom-channel'
export const inject = ['agents']

export interface Config {
  /** Agent preset every external-customer session is composed from. */
  preset?: string
  /** Provider/model fallback when no default-model service is composed. */
  provider?: string
  model?: string
}

export const Config: z<Config> = z.object({
  preset: z.string().default('customer'),
  provider: z.string(),
  model: z.string(),
})

export function apply(ctx: Context, config: Config): void {
  const preset = config.preset ?? 'customer'
  // Host-plane values published by sibling plugins; read them through the
  // global service store (`ctx.get`), never the property proxy, so async
  // handlers running under another fiber still resolve them.
  const adapter = ctx.get('wecomAdapter')
  if (adapter === undefined) {
    throw new Error('wecom-channel: no wecomAdapter provider is mounted (start with @deepseek-ai/dsh-wecom-channel/mock-adapter or a real DLL adapter)')
  }
  const roster = ctx.get('agentPresets')
  if (roster === undefined) {
    throw new Error('wecom-channel: no agent-presets roster is mounted (the customer preset is required)')
  }
  const presetRoster = roster
  const agents = ctx.get('agents')
  if (agents === undefined) {
    throw new Error('wecom-channel: no agents registry is mounted')
  }
  // Capture the guarded values so async closures see the definite type (TS
  // does not carry outer narrowing into async function bodies).
  const channel = adapter
  const registry = agents
  const byExternal = new Map<string, SessionId>()
  const bySession = new Map<SessionId, string>()
  const live = new Map<string, Agent>()

  ctx.provide('wecomChannel', {
    adapter: channel,
    externalChatFor(sessionId) {
      return bySession.get(sessionId)
    },
    sessionFor(externalChatId) {
      return byExternal.get(externalChatId)
    },
    agentFor(externalChatId) {
      return live.get(externalChatId)
    },
  } satisfies WecomChannelService)

  async function resolveSelection(): Promise<{ provider: string; model: string }> {
    const fallback = ctx.get('agentDefaultModel')
    if (fallback !== undefined) {
      const selection = fallback.currentSelection()
      return { provider: selection.provider, model: selection.model }
    }
    return { provider: config.provider ?? 'mock', model: config.model ?? 'mock' }
  }

  async function ensureAgent(externalChatId: string): Promise<Agent> {
    const existing = live.get(externalChatId)
    if (existing !== undefined) return existing
    const sessionId = SessionId(`wecom-${randomUUID()}`)
    const selection = await resolveSelection()
    const handle = await registry.create({
      sessionId,
      meta: { agentPreset: preset },
      agentOptions: { provider: selection.provider, model: selection.model },
      setup: async (agentCtx) => {
        await presetRoster.mount(agentCtx, preset)
      },
    })
    byExternal.set(externalChatId, sessionId)
    bySession.set(sessionId, externalChatId)
    live.set(externalChatId, handle.agent)
    return handle.agent
  }

  async function onInbound(message: WecomInboundMessage): Promise<void> {
    const agent = await ensureAgent(message.externalChatId)
    agent.followup(createUserMessage({
      content: [{ type: 'text', text: message.text }],
      source: { kind: 'wecom', externalChatId: message.externalChatId },
    }))
    await agent.whenIdle()
  }

  ctx.effect(() => {
    channel.onMessage((message) => onInbound(message))
    void channel.start()
    return () => {
      void channel.stop()
    }
  })
}
