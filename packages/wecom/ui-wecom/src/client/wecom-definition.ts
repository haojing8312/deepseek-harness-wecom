/**
 * WeCom customer-session Conversation Node: folds the durable `wecom/session`
 * marker and every inbound `user/message` (source.kind === 'wecom') of one
 * customer session into a single keyed Chat card.
 * @module @deepseek-ai/dsh-client-ui-wecom
 */

import type { SessionEvent } from '@deepseek-ai/dsh-session'
import type {
  ChatConversationViewNode,
  ConversationNodeDefinition,
} from '@deepseek-ai/dsh-client-runtime/client'
// Type-only: pulls the client-safe `wecom/session` SessionEventMap and `wecom`
// MessageSourceMap merges without the host cordis Context augmentation.
import type {} from '@deepseek-ai/dsh-wecom-channel/session-events'
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'

/** Payload rendered by the wecom-customer-session card. */
export interface WecomCustomerChatData {
  /** Stable external customer chat identity. */
  readonly externalChatId: string
  /** Optional customer display name from the adapter. */
  readonly displayName?: string
  /** Count of inbound customer messages seen so far. */
  readonly messageCount: number
  /** The customer's most recent inbound text, when any. */
  readonly latestText?: string
}

declare module '@deepseek-ai/dsh-client-ui-conversation/client' {
  interface ChatNodeDataMap {
    'wecom-customer-session': WecomCustomerChatData
  }
}

interface WecomCustomerState extends WecomCustomerChatData {}

/** The external chat id one event belongs to, when it is a WeCom customer event. */
function externalChatOf(event: SessionEvent): string | undefined {
  if (event.type === 'wecom/session') return event.data.externalChatId
  if (event.type === 'user/message' && event.data.source.kind === 'wecom') {
    return event.data.source.externalChatId
  }
  return undefined
}

/** Durable WeCom customer-session event family folded into one keyed Chat node. */
export const wecomCustomerSessionDefinition: ConversationNodeDefinition<WecomCustomerState> = {
  kind: 'wecom-customer-session',
  target: 'chat',
  match: (event) => {
    const externalChatId = externalChatOf(event)
    if (externalChatId === undefined) return null
    return { id: externalChatId, role: event.type === 'wecom/session' ? 'start' : 'update' }
  },
  start: (_context, match) => {
    if (match.event.type !== 'wecom/session') {
      throw new Error('wecom-customer-session start requires a wecom/session event')
    }
    const { externalChatId, displayName } = match.event.data
    return {
      externalChatId,
      ...(displayName === undefined ? {} : { displayName }),
      messageCount: 0,
    }
  },
  update: (context, match) => {
    if (match.event.type !== 'user/message') return context.state
    const text = match.event.data.content
      .filter((block) => block.type === 'text')
      .map((block) => block.text)
      .join('')
    return {
      ...context.state,
      messageCount: context.state.messageCount + 1,
      ...(text === '' ? {} : { latestText: text }),
    }
  },
  buildViewNode: (context): ChatConversationViewNode | null => {
    if (context.start === undefined || context.state === undefined) return null
    const state = context.state
    return {
      key: context.key,
      kind: 'wecom-customer-session',
      id: context.id,
      target: 'chat',
      anchorSeq: context.start.event.seq,
      location: context.start.location,
      visibility: 'visible',
      data: {
        externalChatId: state.externalChatId,
        ...(state.displayName === undefined ? {} : { displayName: state.displayName }),
        messageCount: state.messageCount,
        ...(state.latestText === undefined ? {} : { latestText: state.latestText }),
      },
    }
  },
}
