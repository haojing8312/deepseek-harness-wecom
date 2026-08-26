/**
 * Client-safe WeCom channel status vocabulary. No cordis `Context` merge, so
 * both the host gateway and the browser face can import it without violating
 * the client/host program split.
 * @module @deepseek-ai/dsh-wecom-channel/status
 */

/** Connection state of the WeCom channel, surfaced to the Web UI. */
export type WecomChannelAdapterStatus =
  | 'disconnected'
  | 'connecting'
  | 'online'
  | 'reconnecting'
  | 'offline'

/** One WeCom channel connection-state snapshot surfaced to the Web UI. */
export interface WecomChannelStatusSnapshot {
  /** Stable adapter id, e.g. `mock` or `vworkapi`; `none` when no adapter mounted. */
  readonly adapterId: string
  /** The adapter's current connection status. */
  readonly status: WecomChannelAdapterStatus
}
