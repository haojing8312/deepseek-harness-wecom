/**
 * In-memory WeCom channel adapter for phase-1 development and tests. Records
 * every outbound reply, can simulate inbound messages through the registered
 * handler, and tracks a connection status for the Web UI. The real vworkApi.dll
 * adapter replaces this via the same seam.
 * @module @deepseek-ai/dsh-wecom-channel/mock-adapter
 */

import type { Context } from '@deepseek-ai/cordis'
import type {
  WecomChannelAdapter, WecomChannelAdapterStatus, WecomInboundMessage,
} from './types.ts'

export const name = 'wecom-adapter-mock'

/** A mock adapter that additionally exposes outbound records and inbound simulation. */
export interface MockWecomAdapter extends WecomChannelAdapter {
  /** Every outbound reply delivered, in order. */
  readonly sent: { externalChatId: string; text: string }[]
  /** Deliver one inbound message through every registered handler. */
  simulate(message: WecomInboundMessage): Promise<void>
  /** Drive the status machine directly (tests / dev diagnostics). */
  setStatus(status: WecomChannelAdapterStatus): void
}

/** Publish `ctx.wecomAdapter` backed by an in-memory adapter. */
export function apply(ctx: Context): void {
  const handlers: ((message: WecomInboundMessage) => Promise<void>)[] = []
  const sent: MockWecomAdapter['sent'] = []
  let status: WecomChannelAdapterStatus = 'disconnected'
  const adapter: MockWecomAdapter = {
    id: 'mock',
    sent,
    get status() {
      return status
    },
    async start() {
      status = 'connecting'
      await Promise.resolve()
      status = 'online'
    },
    async stop() {
      status = 'disconnected'
    },
    async sendText(externalChatId, text) {
      sent.push({ externalChatId, text })
    },
    onMessage(handler) {
      handlers.push(handler)
    },
    async simulate(message) {
      await Promise.all(handlers.map((handler) => handler(message)))
    },
    setStatus(next) {
      status = next
    },
  }
  ctx.provide('wecomAdapter', adapter)
}
