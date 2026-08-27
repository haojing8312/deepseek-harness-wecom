/**
 * WeCom channel driver (host plane). Wires an adapter's inbound messages to
 * per-external-chat Harness agents composed from the restricted `customer`
 * preset, and publishes the {@link WecomChannelService} the preset-mounted
 * `wecom_reply` / `wecom_knowledge_search` tools consume.
 * @module @deepseek-ai/dsh-wecom-channel
 */

import { createHash } from 'node:crypto'
import { isAbsolute, resolve } from 'node:path'
import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import type { Agent, AgentHandle } from '@deepseek-ai/dsh-agent'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import { SessionId, type SessionEvent } from '@deepseek-ai/dsh-session'
import { installSettingsSection, settingsNamespace } from '@deepseek-ai/dsh-settings'
// Type-only: brings the `ctx.agentPresets` Context augmentation into scope.
import type {} from '@deepseek-ai/dsh-agent-presets'
// Type-only: the `session/title` SessionEventMap augmentation the driver pins a
// WeCom customer title with.
import type {} from '@deepseek-ai/dsh-session-title'
import type {} from '@deepseek-ai/dsh-session-persistence'
import type { WecomChannelService, WecomInboundMessage } from './types.ts'

export const name = 'wecom-channel'
export const inject = ['agents']

/** Settings namespace for the WeCom workbench injection configuration. */
export const WECOM_SETTINGS_NAMESPACE = settingsNamespace('wecom')

export interface Config {
  /** Agent preset every external-customer session is composed from. */
  preset?: string
  /** Provider/model fallback when no default-model service is composed. */
  provider?: string
  model?: string
  /** Active channel adapter; the DLL provider is a future swap. */
  adapter?: 'mock' | 'vworkapi'
  /** Installed WeCom PC client path, for DLL injection. */
  wecomClientPath?: string
  /** Pinned WeCom client version the injection targets. */
  wecomVersion?: string
  /** Whether inbound customer messages auto-reply (no manual approval). */
  autoReply?: boolean
  /** Per-customer outbound message rate cap per minute. */
  rateLimitPerMinute?: number
  /** Absolute path of the read-only customer knowledge base. */
  knowledgeRoot?: string
}

export const Config: z<Config> = z.object({
  preset: z.string().default('customer'),
  provider: z.string(),
  model: z.string(),
  adapter: z.union(['mock', 'vworkapi'] as const).default('mock'),
  wecomClientPath: z.string(),
  wecomVersion: z.string(),
  autoReply: z.boolean().default(true),
  rateLimitPerMinute: z.number().step(1).min(0).default(20),
  knowledgeRoot: z.string().default('docs-wecom/knowledge'),
})

export function apply(ctx: Context, config: Config): void {
  const preset = config.preset ?? 'customer'
  // The effective settings layer (user document over the assembly defaults),
  // kept current by the settings section; the driver reads it for behaviors
  // that vary by deployment.
  let source = () => config
  installSettingsSection(ctx, WECOM_SETTINGS_NAMESPACE, Config, config, {
    setSource: (current) => { source = current },
    onChange: () => {
      const current = source()
      ctx.logger.info(`wecom settings changed: adapter=${current.adapter ?? 'mock'}, autoReply=${current.autoReply ?? true}`)
    },
  })
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

  ctx.provide('wecomChannelService', {
    adapter: channel,
    knowledgeRoot: resolveKnowledgeRoot(config.knowledgeRoot),
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

  /** Resolve the knowledge base root to an absolute path (relative to cwd). */
function resolveKnowledgeRoot(root: string | undefined): string {
  const value = root ?? 'docs-wecom/knowledge'
  return isAbsolute(value) ? value : resolve(value)
}

/** Stable session identity for one external chat, so the mapping survives restart. */
  function wecomSessionId(externalChatId: string): SessionId {
    const digest = createHash('sha1').update(externalChatId).digest('hex').slice(0, 32)
    return SessionId(`wecom-${digest}`)
  }

  async function ensureAgent(externalChatId: string): Promise<Agent> {
    const existing = live.get(externalChatId)
    if (existing !== undefined) return existing
    const sessionId = wecomSessionId(externalChatId)
    const selection = await resolveSelection()
    const agentOptions = { provider: selection.provider, model: selection.model }
    const setup = async (agentCtx: Context): Promise<void> => {
      await presetRoster.mount(agentCtx, preset)
    }
    const persistence = ctx.get('sessionPersistence')
    const persisted = persistence !== undefined
      && (await persistence.list()).some((meta) => meta.id === sessionId)
    // Resume the persisted session (context continuity across restart) when the
    // store holds it; otherwise create it fresh. Only a fresh session gets the
    // `wecom/session` marker, which must stay unique per (kind, externalChatId).
    let handle: AgentHandle
    let created: boolean
    if (persisted) {
      handle = await registry.resume({ resumeSessionId: sessionId, agentOptions, setup })
      created = false
    } else {
      handle = await registry.create({
        sessionId,
        meta: { agentPreset: preset, cwd: process.cwd() },
        agentOptions,
        setup,
      })
      created = true
    }
    if (created) {
      handle.agent.session.append('wecom/session', { externalChatId })
    }
    // Pin a human-facing sidebar title (the LLM title provider only handles
    // `user`-source messages, so it never titles a WeCom session). Backfilled on
    // resume when a pre-title session is reopened.
    const hasTitle = handle.agent.session.events.some((event) => event.type === 'session/title')
    if (!hasTitle) {
      handle.agent.session.append('session/title', {
        title: `企微客户 ${externalChatId}`,
        messageSeqs: [],
        source: { kind: 'user' },
      })
    }
    byExternal.set(externalChatId, sessionId)
    bySession.set(sessionId, externalChatId)
    live.set(externalChatId, handle.agent)
    return handle.agent
  }

  /** The latest assistant text produced since `firstSeq`, or undefined when none. */
  function lastAssistantText(events: readonly SessionEvent[], firstSeq: number): string | undefined {
    let text: string | undefined
    for (const event of events) {
      if (event.seq < firstSeq) continue
      if (event.type !== 'assistant/message') continue
      const joined = event.data.message.content
        .filter((block) => block.type === 'text')
        .map((block) => block.text)
        .join('')
      if (joined !== '') text = joined
    }
    return text
  }

  async function onInbound(message: WecomInboundMessage): Promise<void> {
    const agent = await ensureAgent(message.externalChatId)
    const firstSeq = agent.session.seq
    agent.followup(createUserMessage({
      content: [{ type: 'text', text: message.text }],
      source: { kind: 'wecom', externalChatId: message.externalChatId },
    }))
    await agent.whenIdle()
    const turnEvents = agent.session.events.filter((event) => event.seq >= firstSeq)
    // The reply is delivered either by an explicit wecom_reply tool call or, when
    // the model just answered in prose, by auto-sending its final assistant text.
    const repliedByTool = turnEvents.some(
      (event) => event.type === 'tool/call' && event.data.name === 'wecom_reply',
    )
    if (repliedByTool) return
    const reply = lastAssistantText(turnEvents, 0)
    if (reply === undefined) {
      // No usable answer — send a fallback so the customer is never left hanging.
      await channel.sendText(message.externalChatId, '抱歉，我暂时无法回复，请稍后再试。')
      return
    }
    await channel.sendText(message.externalChatId, reply)
  }

  ctx.effect(() => {
    channel.onMessage((message) => onInbound(message))
    // A failed connect (e.g. the WeCom client is not running) must not take the
    // tree down: the adapter flips to 'offline' and the UI surfaces it.
    channel.start().catch((error: unknown) => {
      ctx.logger.warn(`wecom channel start failed: ${error instanceof Error ? error.message : String(error)}`)
    })
    return () => {
      void channel.stop()
    }
  })
}
