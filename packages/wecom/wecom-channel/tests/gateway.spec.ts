import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import WecomChannelGateway from '../src/gateway.ts'
import { apply as mockAdapter } from '../src/mock-adapter.ts'

async function harness(): Promise<Context> {
  const ctx = new Context()
  await ctx.plugin(mockAdapter)
  await ctx.plugin(WecomChannelGateway)
  return ctx
}

describe('wecom-channel gateway', () => {
  it('reports the active adapter id and its live status', async () => {
    const ctx = await harness()
    const gateway = ctx.get('wecomChannel') as WecomChannelGateway

    expect(gateway.status()).toEqual({ adapterId: 'mock', status: 'disconnected' })

    await ctx.wecomAdapter.start()
    expect(gateway.status()).toEqual({ adapterId: 'mock', status: 'online' })

    await ctx.wecomAdapter.stop()
    expect(gateway.status()).toEqual({ adapterId: 'mock', status: 'disconnected' })

    await ctx.fiber.dispose()
  })

  it('reports none/disconnected when no adapter is mounted', async () => {
    const ctx = new Context()
    await ctx.plugin(WecomChannelGateway)
    const gateway = ctx.get('wecomChannel') as WecomChannelGateway
    expect(gateway.status()).toEqual({ adapterId: 'none', status: 'disconnected' })
    await ctx.fiber.dispose()
  })
})
