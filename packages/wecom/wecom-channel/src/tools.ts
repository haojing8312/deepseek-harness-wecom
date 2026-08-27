/**
 * Model-facing WeCom tools, mounted by the `customer` agent preset.
 * `wecom_reply` sends one reply back to the customer through the host channel;
 * `wecom_knowledge_search` reads the read-only knowledge base. No shell,
 * filesystem, network, or delegation tools are composed into this preset —
 * external customer messages are untrusted input.
 * @module @deepseek-ai/dsh-wecom-channel/tools
 */

import { readdir, readFile } from 'node:fs/promises'
import { join, relative } from 'node:path'
import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import { defineTool } from '@deepseek-ai/dsh-tools'
import type {} from './types.ts'

export const name = 'wecom-tools'
export const inject = ['tools', 'systemPrompt']

export interface Config {
  /** Root directory of the read-only knowledge base. */
  knowledgeRoot?: string
}

export const Config: z<Config> = z.object({
  knowledgeRoot: z.string(),
})

/** Customer-agent guidance: always deliver the reply through wecom_reply. */
const CUSTOMER_GUIDANCE = [
  '你是企微销冠工作台的客户服务助手。',
  '用中文、简洁、专业地回复客户。',
  '涉及产品/业务事实时，先调用 wecom_knowledge_search 查询只读知识库。',
  '你的最终回复必须通过调用 wecom_reply 工具发送给客户，不要只输出文本。',
  '你无法访问文件、互联网或内部系统，如实告知客户。',
].join('\n')

/** Read-only, top-k keyword search over a directory of markdown/text files. */
async function searchKnowledge(
  root: string,
  query: string,
  limit: number,
): Promise<{ source: string; snippet: string }[]> {
  const tokens = query.toLowerCase().split(/\s+/).filter((token) => token.length > 0)
  const results: { source: string; snippet: string }[] = []
  for (const file of await readdir(root, { recursive: true })) {
    if (!file.endsWith('.md') && !file.endsWith('.txt')) continue
    const path = join(root, file)
    let content: string
    try {
      content = await readFile(path, 'utf8')
    } catch {
      continue
    }
    for (const line of content.split(/\r?\n/)) {
      if (line.length === 0 || results.length >= limit) continue
      const lower = line.toLowerCase()
      if (tokens.some((token) => lower.includes(token))) {
        results.push({ source: relative(root, path), snippet: line.slice(0, 200) })
      }
    }
  }
  return results
}

export function apply(ctx: Context, config: Config): void {
  ctx.systemPrompt.section({
    name: 'wecom-customer-guidance',
    order: 5,
    text: CUSTOMER_GUIDANCE,
  })
  ctx.tools.register(defineTool({
    name: 'wecom_reply',
    description:
      'Send one text reply to the external WeCom customer this conversation belongs to. '
      + 'Call this to deliver your final answer to the customer.',
    parameters: {
      text: { type: 'string', required: true, description: 'The reply text to send to the customer.' },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: { sentTo: { type: 'string', required: true } },
      },
      render: (_args, value) => [{ type: 'text', text: `Reply sent to ${value.sentTo}.` }],
    },
    async execute(args, exec) {
      if (exec.agent === undefined) {
        throw new Error('wecom_reply requires an owning WeCom session')
      }
      const channel = ctx.get('wecomChannelService')
      const externalChatId = channel?.externalChatFor(exec.agent.session.id)
      if (channel === undefined || externalChatId === undefined) {
        throw new Error('wecom_reply can only be called from a WeCom customer session')
      }
      await channel.adapter.sendText(externalChatId, args.text)
      return { sentTo: externalChatId }
    },
    presentCall: (args) => ({ card: 'generic', title: 'Reply to customer', kind: 'other', rawInput: args }),
  }))

  ctx.tools.register(defineTool({
    name: 'wecom_knowledge_search',
    description:
      'Search the read-only product knowledge base. Use it for product facts before replying. '
      + 'Returns matching passages with their source file. Read-only.',
    parameters: {
      query: { type: 'string', required: true, description: 'The knowledge query, in keywords.' },
      limit: { type: 'integer', description: 'Maximum number of results (default 5).' },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          results: {
            type: 'array',
            required: true,
            items: {
              type: 'object',
              additionalProperties: false,
              properties: {
                source: { type: 'string', required: true },
                snippet: { type: 'string', required: true },
              },
            },
          },
        },
      },
      render: (_args, value) => value.results.length === 0
        ? [{ type: 'text', text: 'No knowledge base matches.' }]
        : [{ type: 'text', text: value.results.map((r) => `${r.source}: ${r.snippet}`).join('\n') }],
    },
    async execute(args) {
      const root = config.knowledgeRoot ?? 'docs-wecom/knowledge'
      return { results: await searchKnowledge(root, args.query, args.limit ?? 5) }
    },
  }))
}
