import { dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import Loader from '@deepseek-ai/cordis-plugin-loader'
import Include from '@deepseek-ai/cordis-plugin-include'
import AgentRegistry from '@deepseek-ai/dsh-agent'
import AgentLoop from '@deepseek-ai/dsh-agent-loop'
import AgentPresets from '@deepseek-ai/dsh-agent-presets'
import LlmRuntime, {
  CallId, LlmAdapter,
  type GenerateOptions, type LlmResolvedModelInfo, type StreamChunk,
} from '@deepseek-ai/dsh-llm'
import SessionStore, { SessionId } from '@deepseek-ai/dsh-session'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime from '@deepseek-ai/dsh-tools'

import { apply as wecomChannel } from '../src/index.ts'
import { apply as mockAdapter } from '../src/mock-adapter.ts'
import type { MockWecomAdapter } from '../src/mock-adapter.ts'
// Type-only: loads the `wecom/session` + `wecom` source merges into this test program.
import type {} from '../src/session-events.ts'

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

function toolCallResponse(rawCallId: string, name: string, args: object): StreamChunk[] {
  const callId = CallId(rawCallId)
  const argumentsJson = JSON.stringify(args)
  const chunks: StreamChunk[] = []
  let index = 0
  chunks.push(
    { type: 'block-start', index, blockType: 'tool-call' },
    { type: 'tool-call-delta', index, id: callId, name, argumentsDelta: argumentsJson.slice(0, 5) },
    { type: 'tool-call-delta', index, id: callId, argumentsDelta: argumentsJson.slice(5) },
    { type: 'block-end', index, block: { type: 'tool-call', id: callId, name, arguments: argumentsJson } },
    { type: 'usage', usage: { inputTokens: 10, outputTokens: 5 } },
    { type: 'finish', reason: { kind: 'tool-calls' } },
  )
  return chunks
}

/** Scripted LLM adapter: each model call consumes the next entry. */
class MockAdapter extends LlmAdapter {
  requests: GenerateOptions[] = []
  constructor(private script: StreamChunk[][]) {
    super()
  }
  override resolveModel(provider: string, model: string): Promise<LlmResolvedModelInfo> {
    return Promise.resolve({ provider, id: model, name: model })
  }
  async * stream(options: GenerateOptions): AsyncIterable<StreamChunk> {
    this.requests.push(options)
    const entry = this.script.shift()
    if (!entry) throw new Error('MockAdapter: script exhausted')
    for (const chunk of entry) {
      if (options.signal?.aborted) throw new Error('aborted')
      yield chunk
    }
  }
}

async function harness(script: StreamChunk[][]) {
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
  await ctx.plugin(mockAdapter)
  await ctx.plugin(wecomChannel, { provider: 'mock', model: 'mock' })
  const adapter = new MockAdapter(script)
  ctx.llm.registerAdapter(['mock'], adapter)
  return { ctx, adapter }
}

describe('wecom-channel', () => {
  it('composes a customer agent with exactly the two WeCom tools', async () => {
    const { ctx } = await harness([])
    const handle = await ctx.agents.create({
      sessionId: SessionId('customer-whitelist'),
      meta: { agentPreset: 'customer' },
      agentOptions: { provider: 'mock', model: 'mock' },
      setup: async (agentCtx) => {
        await ctx.agentPresets.mount(agentCtx, 'customer')
      },
    })
    const schemas = ctx.tools.schemas(handle.agent).map((schema) => schema.name).sort()
    expect(schemas).toEqual(['wecom_knowledge_search', 'wecom_reply'])
    await ctx.fiber.dispose()
  })

  it('sends an auto reply through the channel when a customer messages', async () => {
    const { ctx } = await harness([
      toolCallResponse('call_reply_1', 'wecom_reply', { text: '您好，有什么可以帮您？' }),
      textResponse(''),
    ])
    const mock = ctx.wecomAdapter as MockWecomAdapter
    await mock.simulate({ externalChatId: 'ext-100', text: '你好，你们有什么产品？' })
    expect(mock.sent).toEqual([{ externalChatId: 'ext-100', text: '您好，有什么可以帮您？' }])
    await ctx.fiber.dispose()
  })

  it('maps one external chat to one stable Harness session', async () => {
    const { ctx } = await harness([
      toolCallResponse('call_reply_1', 'wecom_reply', { text: '第一段回复' }),
      textResponse(''),
      textResponse('好的'),
    ])
    const mock = ctx.wecomAdapter as MockWecomAdapter
    expect(ctx.wecomChannelService.sessionFor('ext-100')).toBeUndefined()
    await mock.simulate({ externalChatId: 'ext-100', text: '第一条消息' })
    const sessionId = ctx.wecomChannelService.sessionFor('ext-100')
    expect(sessionId).toBeDefined()
    await mock.simulate({ externalChatId: 'ext-100', text: '第二条消息' })
    expect(ctx.wecomChannelService.sessionFor('ext-100')).toBe(sessionId)
    const agent = ctx.wecomChannelService.agentFor('ext-100')
    const wecomMessages = agent!.session.events.filter(
      (event) => event.type === 'user/message' && event.data.source.kind === 'wecom',
    )
    expect(wecomMessages).toHaveLength(2)
    await ctx.fiber.dispose()
  })

  it('appends a wecom/session marker when a customer session is created', async () => {
    const { ctx } = await harness([textResponse('ok')])
    const mock = ctx.wecomAdapter as MockWecomAdapter
    await mock.simulate({ externalChatId: 'ext-200', text: '第一条消息' })
    const agent = ctx.wecomChannelService.agentFor('ext-200')
    const marker = agent!.session.events.find((event) => event.type === 'wecom/session')
    expect(marker).toBeDefined()
    if (marker?.type !== 'wecom/session') throw new Error('expected a wecom/session event')
    expect(marker.data.externalChatId).toBe('ext-200')
    const title = agent!.session.events.find((event) => event.type === 'session/title')
    expect(title?.type === 'session/title' && title.data.title).toBe('企微客户 ext-200')
    await ctx.fiber.dispose()
  })

  it('serializes concurrent messages for one customer without a resume race', async () => {
    const { ctx } = await harness([textResponse('ok'), textResponse('ok')])
    const mock = ctx.wecomAdapter as MockWecomAdapter
    await Promise.all([
      mock.simulate({ externalChatId: 'ext-race', text: '第一条' }),
      mock.simulate({ externalChatId: 'ext-race', text: '第二条' }),
    ])
    const agent = ctx.wecomChannelService.agentFor('ext-race')
    const wecomMessages = agent!.session.events.filter(
      (event) => event.type === 'user/message' && event.data.source.kind === 'wecom',
    )
    expect(wecomMessages).toHaveLength(2)
    expect(agent!.session.events.filter((event) => event.type === 'wecom/session')).toHaveLength(1)
    await ctx.fiber.dispose()
  })
})
