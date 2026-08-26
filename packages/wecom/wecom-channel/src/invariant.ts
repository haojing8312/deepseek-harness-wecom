/**
 * Package-owned invariant companion for `@deepseek-ai/dsh-wecom-channel`.
 * @module @deepseek-ai/dsh-wecom-channel/invariant
 */

import type { Context } from '@deepseek-ai/cordis'
import type { InvariantInstaller } from '@deepseek-ai/dsh-invariants'

const PACKAGE_NAME = '@deepseek-ai/dsh-wecom-channel'

/** Cordis companion plugin name. */
export const name = 'wecom-channel-invariant'
/** Service required before the companion can register. */
export const inject = ['invariants']

/**
 * No runtime invariant yet: the channel driver's durable contract (session↔chat
 * mapping, inbound source tagging) is asserted by the package test, and the
 * model-visible `user/message` source it appends is already validated by the
 * session surface. Register nothing so the companion owns no mutable relation.
 */
const install: InvariantInstaller = () => {}

/**
 * Register this package's invariant companion.
 * @param ctx - Cordis context carrying the invariant service.
 * @returns the installed registration's disposer after setup succeeds.
 */
export const apply = (ctx: Context): Promise<() => void> =>
  Promise.resolve(ctx.invariants.register(PACKAGE_NAME, install))
