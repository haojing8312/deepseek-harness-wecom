import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import Loader from '@deepseek-ai/cordis-plugin-loader'
import Include from '@deepseek-ai/cordis-plugin-include'
import AgentRegistry from '@deepseek-ai/dsh-agent'
import AgentLoop from '@deepseek-ai/dsh-agent-loop'
import AgentPresets from '@deepseek-ai/dsh-agent-presets'
import JsonlSessionPersistence from '@deepseek-ai/dsh-session-persistence-jsonl'
import LlmRuntime, {
  LlmAdapter, type GenerateOptions, type LlmResolvedModelInfo, type StreamChunk,
} from '@deepseek-ai/dsh-llm'
import SessionStore from '@deepseek-ai/dsh-session'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime from '@deepseek-ai/dsh-tools'

import { apply as wecomChannel } from '../src/index.ts'
import { apply as mockAdapter } from '../src/mock-adapter.ts'
import type { MockWecomAdapter } from '../src/mock-adapter.ts'

const PRESET_ROOT = join(dirname(fileURLToPath(import.meta.url)), '../../../../apps/cli/config/agent-presets')

function textResponse(text: string): StreamChunk[] {
  return [
    { type: 'block-start', index: 0, blockType: 'text' },
    ...Array.from(text, (char): StreamChunk => ({ type: 'text-delta', index: 0, text: char })),
    { type: 'block-end', index: 0, block: { type: 'text', text } },
    { type: 'usage', usage: { inputTokens: 10, outputTokens: text.length } },
    { type: 'finish', reason: { kind: 'stop' } },
  ]
}

class MockAdapter extends LlmAdapter {
  constructor(private script: StreamChunk[][]) {
    super()
  }
  override resolveModel(provider: string, model: string): Promise<LlmResolvedModelInfo> {
    return Promise.resolve({ provider, id: model, name: model })
  }
  async * stream(options: GenerateOptions): AsyncIterable<StreamChunk> {
    const entry = this.script.shift()
    if (!entry) throw new Error('MockAdapter: script exhausted')
    for (const chunk of entry) {
      if (options.signal?.aborted) throw new Error('aborted')
      yield chunk
    }
  }
}

/** Mount the full wecom harness over a shared JSONL persistence root. */
async function harness(root: string, script: StreamChunk[][]) {
  const ctx = new Context()
  ctx.baseUrl = pathToFileURL(PRESET_ROOT).href + '/'
  await ctx.plugin(Loader)
  ctx.loader.builtins.include = Include
  await ctx.plugin(LlmRuntime)
  await ctx.plugin(SessionStore)
  await ctx.plugin(SystemPrompt, { persona: '' })
  await ctx.plugin(ToolRuntime)
  await ctx.plugin(AgentRegistry)
  await ctx.plugin(AgentLoop, { agents: [] })
  await ctx.plugin(AgentPresets, {
    default: 'customer',
    roots: [{ path: PRESET_ROOT, trust: 'system' }],
    includeUserRoot: false,
  })
  await ctx.plugin(JsonlSessionPersistence, { root, compression: 'none' })
  await ctx.plugin(mockAdapter)
  await ctx.plugin(wecomChannel, { provider: 'mock', model: 'mock' })
  const adapter = new MockAdapter(script)
  ctx.llm.registerAdapter(['mock'], adapter)
  return { ctx }
}

describe('wecom-channel restart recovery', () => {
  it('resumes the same session for one external chat after a restart', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-wecom-restart-'))
    try {
      const first = await harness(root, [textResponse('第一段回复')])
      const firstMock = first.ctx.wecomAdapter as MockWecomAdapter
      await firstMock.simulate({ externalChatId: 'ext-restart', text: '第一条消息' })
      const firstSessionId = first.ctx.wecomChannelService.sessionFor('ext-restart')
      expect(firstSessionId).toBeDefined()
      const firstAgent = first.ctx.wecomChannelService.agentFor('ext-restart')!
      await first.ctx.sessions.flush(firstAgent.session)
      await first.ctx.fiber.dispose()

      // Restart: a fresh process over the same persistence root.
      const second = await harness(root, [textResponse('第二段回复')])
      const secondMock = second.ctx.wecomAdapter as MockWecomAdapter
      await secondMock.simulate({ externalChatId: 'ext-restart', text: '第二条消息' })
      expect(second.ctx.wecomChannelService.sessionFor('ext-restart')).toBe(firstSessionId)
      const resumed = second.ctx.wecomChannelService.agentFor('ext-restart')!
      const wecomMessages = resumed.session.events.filter(
        (event) => event.type === 'user/message' && event.data.source.kind === 'wecom',
      )
      expect(wecomMessages).toHaveLength(2)
      // The marker must stay unique even across resume.
      const markers = resumed.session.events.filter((event) => event.type === 'wecom/session')
      expect(markers).toHaveLength(1)
      await second.ctx.fiber.dispose()
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })
})
