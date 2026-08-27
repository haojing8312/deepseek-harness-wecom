/** Browser plugin for WeCom customer-session Conversation Nodes and settings. */

import type { ClientContext, SettingsScope } from '@deepseek-ai/dsh-client-runtime/client'
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
// Type-only: the settings.plugin.item slot declaration and the ctx.settingsScope
// Context merge. Cross-plugin collaboration stays type-only (client bundle purity).
import type {} from '@deepseek-ai/dsh-client-ui-settings-plugins/client'
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'
import { wecomCustomerSessionDefinition } from './wecom-definition.ts'
import { WecomCustomerSessionCard, type WecomCustomerInjected } from './WecomCustomerSessionCard.ts'
import {
  WECOM_SETTINGS_NS, WecomSettingsCard,
  type WecomSettingsInjected, type WecomSettingsValue,
} from './wecom-settings-card.ts'
import {
  WECOM_KNOWLEDGE_NS, WecomKnowledgeCard,
  type WecomKnowledgeInjected, type WecomKnowledgeOps,
} from './wecom-knowledge-card.ts'

/** Required services for the Definition, keyed renderer, status seat, and settings cards. */
export const inject = ['conversationEvents', 'slots', 'remote', 'remote.wecomChannel', 'settingsScope']

function remoteError(error: unknown): string {
  if (typeof error === 'string') return error
  if (typeof error === 'object' && error !== null && 'message' in error) {
    return String((error as { message: unknown }).message)
  }
  return JSON.stringify(error)
}

function knowledgeOps(ctx: ClientContext): WecomKnowledgeOps {
  const remote = ctx.remote.wecomChannel
  return {
    async list() {
      const result = await remote.knowledgeList()
      if (result.ok) return result.value
      throw new Error(remoteError(result.error))
    },
    async read(path) {
      const result = await remote.knowledgeRead(path)
      if (result.ok) return result.value
      throw new Error(remoteError(result.error))
    },
    async write(path, content) {
      const result = await remote.knowledgeWrite(path, content)
      if (!result.ok) throw new Error(remoteError(result.error))
    },
    async delete(path) {
      const result = await remote.knowledgeDelete(path)
      if (!result.ok) throw new Error(remoteError(result.error))
    },
  }
}

/** Register the Definition, keyed Chat renderer, and settings cards. */
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

  const wecomKnowledge = knowledgeOps(ctx)

  ctx.slots.inject('settings.plugin.item', function* () {
    yield ctx.slots.register({
      name: 'settings.plugin.item',
      key: WECOM_SETTINGS_NS,
      inject: (): WecomSettingsInjected => ({
        scope: ctx.settingsScope.bind({ namespace: WECOM_SETTINGS_NS }) as SettingsScope<WecomSettingsValue>,
      }),
    }, WecomSettingsCard)

    yield ctx.slots.register({
      name: 'settings.plugin.item',
      key: WECOM_KNOWLEDGE_NS,
      inject: (): WecomKnowledgeInjected => ({
        knowledge: wecomKnowledge,
      }),
    }, WecomKnowledgeCard)
  })
}
