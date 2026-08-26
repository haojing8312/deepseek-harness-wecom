import { createElement } from 'react'
import type { PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
import type { WecomCustomerChatData } from './wecom-definition.ts'

/** Keyed renderer for the wecom-customer-session Chat node. */
export function WecomCustomerSessionCard(
  { node }: PropsRuntime<'conversation.chat.node', 'wecom-customer-session'>,
) {
  const data: WecomCustomerChatData = node.data
  return createElement('section', { className: 'wecom-customer-session' },
    createElement('header', null,
      createElement('strong', null, '企微客户会话'),
      createElement('span', null, data.displayName ?? data.externalChatId),
    ),
    createElement('div', null, `入站消息 ${data.messageCount}`),
    ...(data.latestText === undefined
      ? []
      : [createElement('p', { className: 'wecom-customer-session-latest' }, data.latestText)]),
  )
}
