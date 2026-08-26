/** Browser plugin for WeCom customer-session Conversation Nodes. */

import type { ClientContext } from '@deepseek-ai/dsh-client-runtime/client'
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
import { wecomCustomerSessionDefinition } from './wecom-definition.ts'
import { WecomCustomerSessionCard, type WecomCustomerInjected } from './WecomCustomerSessionCard.ts'

/** Required services for the Definition, keyed renderer, and status seat. */
export const inject = ['conversationEvents', 'slots', 'remote.wecomChannel']

/** Register the Definition and keyed Chat renderer. */
export function apply(ctx: ClientContext): void {
  ctx.conversationEvents.register(wecomCustomerSessionDefinition)
  ctx.slots.inject('conversation.chat.node', () => ctx.slots.register({
    name: 'conversation.chat.node',
    key: 'wecom-customer-session',
    inject: (): WecomCustomerInjected => ({
      status: async () => {
        const result = await ctx.remote.wecomChannel.status()
        if (result.ok) return result.value
        return { adapterId: 'none', status: 'disconnected' }
      },
    }),
  }, WecomCustomerSessionCard))
}
