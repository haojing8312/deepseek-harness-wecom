/**
 * WeCom channel status vocabulary for the workbench surface. Re-exports the
 * client-safe shared types and adds the zh display labels.
 * @module @deepseek-ai/dsh-client-ui-wecom
 */

import type { WecomChannelAdapterStatus } from '@deepseek-ai/dsh-wecom-channel/status'

export type { WecomChannelAdapterStatus, WecomChannelStatusSnapshot } from '@deepseek-ai/dsh-wecom-channel/status'

/** Human label per status, zh for the workbench surface. */
export const WECOM_STATUS_LABEL: Record<WecomChannelAdapterStatus, string> = {
  disconnected: '未连接',
  connecting: '连接中…',
  online: '在线',
  reconnecting: '重连中…',
  offline: '离线',
}
