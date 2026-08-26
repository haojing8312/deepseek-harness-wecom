/**
 * In-memory WeCom channel adapter for phase-1 development and tests. Records
 * every outbound reply and can simulate inbound messages through the registered
 * handler. The real vworkApi.dll adapter replaces this via the same seam.
 * @module @deepseek-ai/dsh-wecom-channel/mock-adapter
 */

import type { Context } from '@deepseek-ai/cordis'
import type { WecomChannelAdapter, WecomInboundMessage } from './types.ts'

export const name = 'wecom-adapter-mock'

/** A mock adapter that additionally exposes outbound records and inbound simulation. */
export interface MockWecomAdapter extends WecomChannelAdapter {
  /** Every outbound reply delivered, in order. */
  readonly sent: { externalChatId: string; text: string }[]
  /** Deliver one inbound message through every registered handler. */
  simulate(message: WecomInboundMessage): Promise<void>
}

/** Publish `ctx.wecomAdapter` backed by an in-memory adapter. */
export function apply(ctx: Context): void {
  const handlers: ((message: WecomInboundMessage) => Promise<void>)[] = []
  const sent: MockWecomAdapter['sent'] = []
  const adapter: MockWecomAdapter = {
    id: 'mock',
    sent,
    async start() {},
    async stop() {},
    async sendText(externalChatId, text) {
      sent.push({ externalChatId, text })
    },
    onMessage(handler) {
      handlers.push(handler)
    },
    async simulate(message) {
      await Promise.all(handlers.map((handler) => handler(message)))
    },
  }
  ctx.provide('wecomAdapter', adapter)
}
