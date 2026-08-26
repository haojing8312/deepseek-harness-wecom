/** Browser plugin for WeCom customer-session Conversation Nodes. */

import type { ClientContext } from '@deepseek-ai/dsh-client-runtime/client'
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
import { wecomCustomerSessionDefinition } from './wecom-definition.ts'
import { WecomCustomerSessionCard } from './WecomCustomerSessionCard.ts'

/** Required services for the Definition and keyed renderer. */
export const inject = ['conversationEvents', 'slots']

/** Register the Definition and keyed Chat renderer. */
export function apply(ctx: ClientContext): void {
  ctx.conversationEvents.register(wecomCustomerSessionDefinition)
  ctx.slots.inject('conversation.chat.node', () => ctx.slots.register({
    name: 'conversation.chat.node',
    key: 'wecom-customer-session',
  }, WecomCustomerSessionCard))
}
