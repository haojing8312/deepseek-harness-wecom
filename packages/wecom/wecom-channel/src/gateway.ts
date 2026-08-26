/**
 * WeCom channel connection-status remote: a read-only projection the Web UI
 * polls. Mounted as its own plugin row so it survives the driver; it reads the
 * adapter's live status through the global service store.
 * @module @deepseek-ai/dsh-wecom-channel/gateway
 */

import type { Context } from '@deepseek-ai/cordis'
import { Remote, TypertRemoteService } from '@deepseek-ai/dsh-typert-protocol'
import type { WecomChannelAdapterStatus, WecomChannelStatusSnapshot } from './status.ts'

/** Remote-only service exposing the active WeCom channel connection status. */
export class WecomChannelGateway extends TypertRemoteService {
  constructor(ctx: Context) {
    super(ctx, 'wecomChannel')
  }

  /** Read the adapter's live connection status. */
  @Remote('status')
  status(): WecomChannelStatusSnapshot {
    const adapter = this.ctx.get('wecomAdapter') as
      | { readonly id: string; readonly status: WecomChannelAdapterStatus }
      | undefined
    if (adapter === undefined) return { adapterId: 'none', status: 'disconnected' }
    return { adapterId: adapter.id, status: adapter.status }
  }
}

export default WecomChannelGateway
