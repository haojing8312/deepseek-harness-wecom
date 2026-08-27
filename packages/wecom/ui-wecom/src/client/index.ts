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

/** Required services for the Definition, keyed renderer, status seat, and settings card. */
export const inject = ['conversationEvents', 'slots', 'remote.wecomChannel', 'settingsScope']

/** Register the Definition, keyed Chat renderer, and settings card. */
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

  ctx.slots.inject('settings.plugin.item', () => ctx.slots.register({
    name: 'settings.plugin.item',
    key: WECOM_SETTINGS_NS,
    inject: (): WecomSettingsInjected => ({
      scope: ctx.settingsScope.bind({ namespace: WECOM_SETTINGS_NS }) as SettingsScope<WecomSettingsValue>,
    }),
  }, WecomSettingsCard))
}
