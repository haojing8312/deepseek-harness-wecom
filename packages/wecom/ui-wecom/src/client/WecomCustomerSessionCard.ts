import { createElement, useEffect, useState } from 'react'
import type { PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
import type { WecomCustomerChatData } from './wecom-definition.ts'
import { WECOM_STATUS_LABEL, type WecomChannelStatusSnapshot } from './wecom-status.ts'

/** Status fetch seat injected from the plugin's Client remote access. */
export interface WecomCustomerInjected {
  /** Read the WeCom channel connection status. */
  status: () => Promise<WecomChannelStatusSnapshot>
}

/** Complete keyed Chat renderer props. */
export type WecomCustomerSessionCardProps =
  PropsRuntime<'conversation.chat.node', 'wecom-customer-session'>
  & WecomCustomerInjected

/** Keyed renderer for the wecom-customer-session Chat node. */
export function WecomCustomerSessionCard(
  { node, status }: WecomCustomerSessionCardProps,
) {
  const [snapshot, setSnapshot] = useState<WecomChannelStatusSnapshot | undefined>(undefined)
  useEffect(() => {
    let alive = true
    void status().then((value) => { if (alive) setSnapshot(value) })
    return () => { alive = false }
  }, [status])
  const data: WecomCustomerChatData = node.data
  const statusText = snapshot === undefined ? '连接中…' : WECOM_STATUS_LABEL[snapshot.status]
  return createElement('section', { className: 'wecom-customer-session' },
    createElement('header', null,
      createElement('strong', null, '企微客户会话'),
      createElement('span', null, data.displayName ?? data.externalChatId),
    ),
    createElement('div', null, `入站消息 ${data.messageCount}`),
    createElement('div', { className: 'wecom-customer-session-status' },
      createElement('span', { className: `wecom-status wecom-status-${snapshot?.status ?? 'connecting'}` }),
      statusText,
    ),
    ...(data.latestText === undefined
      ? []
      : [createElement('p', { className: 'wecom-customer-session-latest' }, data.latestText)]),
  )
}
