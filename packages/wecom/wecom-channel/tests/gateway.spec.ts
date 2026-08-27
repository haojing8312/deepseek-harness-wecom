import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import WecomChannelGateway from '../src/gateway.ts'
import { apply as mockAdapter } from '../src/mock-adapter.ts'
import type { WecomChannelService } from '../src/types.ts'

async function harness(knowledgeRoot?: string): Promise<Context> {
  const ctx = new Context()
  await ctx.plugin(mockAdapter)
  if (knowledgeRoot !== undefined) {
    ctx.provide('wecomChannelService', {
      adapter: ctx.wecomAdapter,
      knowledgeRoot,
      externalChatFor: () => undefined,
      sessionFor: () => undefined,
      agentFor: () => undefined,
    } satisfies WecomChannelService)
  }
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

  describe('knowledge operations', () => {
    it('lists, reads, writes and deletes knowledge files inside the root', async () => {
      const root = await mkdtemp(join(tmpdir(), 'dsh-wecom-kb-'))
      try {
        await mkdir(join(root, 'nested'))
        await writeFile(join(root, 'a.md'), '# A\n内容甲', 'utf8')
        await writeFile(join(root, 'nested', 'b.txt'), '内容乙', 'utf8')
        const ctx = await harness(root)
        const gateway = ctx.get('wecomChannel') as WecomChannelGateway

        expect(await gateway.knowledgeList()).toEqual([
          { path: 'a.md', size: 13 },
          { path: 'nested/b.txt', size: 9 },
        ])
        expect((await gateway.knowledgeRead('nested/b.txt')).content).toBe('内容乙')

        await gateway.knowledgeWrite('nested/c.md', '新增内容')
        expect((await gateway.knowledgeRead('nested/c.md')).content).toBe('新增内容')

        await gateway.knowledgeDelete('a.md')
        const paths = (await gateway.knowledgeList()).map((entry) => entry.path)
        expect(paths).toEqual(['nested/b.txt', 'nested/c.md'])

        await ctx.fiber.dispose()
      } finally {
        await rm(root, { recursive: true, force: true })
      }
    })

    it('rejects a path that escapes the knowledge root', async () => {
      const root = await mkdtemp(join(tmpdir(), 'dsh-wecom-kb-safe-'))
      try {
        const ctx = await harness(root)
        const gateway = ctx.get('wecomChannel') as WecomChannelGateway
        expect(() => gateway.knowledgeRead('../outside.md')).toThrow(/escapes the knowledge root/)
        expect(() => gateway.knowledgeWrite('sub/../../outside.md', 'x')).toThrow(/escapes the knowledge root/)
        await ctx.fiber.dispose()
      } finally {
        await rm(root, { recursive: true, force: true })
      }
    })
  })
})
