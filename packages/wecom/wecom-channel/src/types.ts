/**
 * WeCom channel seam: the swappable adapter contract (mock today, a real
 * vworkApi.dll adapter for delivery), the host channel service the preset tools
 * reach, and the module augmentations that make an inbound WeCom message a
 * first-class model-visible source.
 * @module @deepseek-ai/dsh-wecom-channel/types
 */

import type { Agent } from '@deepseek-ai/dsh-agent'
import type { SessionId } from '@deepseek-ai/dsh-session'
// Type-only: pulls the shared `wecom/session` SessionEventMap and `wecom`
// MessageSourceMap merges into host consumers of this module.
import type {} from './session-events.ts'
export type { WecomChannelAdapterStatus, WecomChannelStatusSnapshot } from './status.ts'
import type { WecomChannelAdapterStatus } from './status.ts'

/** One inbound message from an external WeCom customer chat. */
export interface WecomInboundMessage {
  /** Stable identity of the external customer chat (the WeCom conversation). */
  readonly externalChatId: string
  /** The text the customer sent. */
  readonly text: string
}

/**
 * A WeCom channel adapter — the swappable provider behind the bridge. The mock
 * adapter and the real vworkApi.dll adapter implement the same seam, so moving
 * to the DLL is a provider replacement, not a rewrite.
 */
export interface WecomChannelAdapter {
  /** Stable adapter id, e.g. `mock` or `vworkapi`. */
  readonly id: string
  /** Current connection status, surfaced to the Web UI. */
  readonly status: WecomChannelAdapterStatus
  /** Connect the channel (DLL injection / transport). No-op for the mock. */
  start(): Promise<void>
  /** Disconnect the channel. */
  stop(): Promise<void>
  /** Deliver one outbound text reply to an external chat. */
  sendText(externalChatId: string, text: string): Promise<void>
  /** Register the inbound handler; the adapter calls it per inbound message. */
  onMessage(handler: (message: WecomInboundMessage) => Promise<void>): void
}

/**
 * Host-plane WeCom channel service. The channel driver publishes it; the
 * preset-mounted tools resolve it through `ctx.get('wecomChannelService')`.
 */
export interface WecomChannelService {
  /** The active channel adapter. */
  readonly adapter: WecomChannelAdapter
  /** Absolute path of the read-only knowledge base the tools search. */
  readonly knowledgeRoot: string
  /** The external chat id a session belongs to, when it is a WeCom session. */
  externalChatFor(sessionId: SessionId): string | undefined
  /** The session id an external chat is mapped to, when one exists. */
  sessionFor(externalChatId: string): SessionId | undefined
  /** The live agent for an external chat, when one is running. */
  agentFor(externalChatId: string): Agent | undefined
}

declare module '@deepseek-ai/cordis' {
  interface Context {
    /** The active WeCom channel adapter (set by an adapter provider). */
    wecomAdapter: WecomChannelAdapter
    /**
     * Host-plane WeCom channel service (adapter + session↔chat mapping), the
     * preset-mounted tools reach. Named distinctly from the client-facing
     * `wecomChannel` remote (the gateway), which owns the `remote.wecomChannel`
     * surface.
     */
    wecomChannelService: WecomChannelService
  }
}
