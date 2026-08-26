import { describe, expect, it } from 'vitest'
import type {
  ChatConversationViewNode, ChatSnapshot, ConversationEventInput,
  ConversationNodeDefinition, ConversationViewDefinition,
} from '@deepseek-ai/dsh-client-runtime/client'
import { ConversationNodeAssembler } from '@deepseek-ai/dsh-client-runtime/client'
import { chatViewDefinition } from '@deepseek-ai/dsh-client-ui-conversation/src/client/conversation-nodes/chat-snapshot-builder.ts'
import { unknownFallbackDefinition } from '@deepseek-ai/dsh-client-ui-conversation/src/client/conversation-nodes/fallback.ts'
import { wecomCustomerSessionDefinition } from '../src/client/wecom-definition.ts'

const DEFINITIONS: readonly ConversationNodeDefinition[] = [wecomCustomerSessionDefinition]

class TestEventDefinitions {
  entries(): readonly ConversationNodeDefinition[] {
    return DEFINITIONS
  }

  fallbackEntry(): ConversationNodeDefinition {
    return unknownFallbackDefinition
  }
}

class TestViewDefinitions {
  entries(): readonly ConversationViewDefinition[] {
    return [chatViewDefinition]
  }
}

function at(
  seq: number,
  type: string,
  data: unknown,
  extra: Record<string, unknown> = {},
): ConversationEventInput {
  return {
    event: {
      seq,
      time: 1_700_000_000_000 + seq,
      type,
      data,
      ...extra,
    } as unknown as ConversationEventInput['event'],
    view: undefined,
  }
}

function assembler(entries: readonly ConversationEventInput[] = [], hasMore = false): ConversationNodeAssembler {
  const value = new ConversationNodeAssembler(new TestEventDefinitions(), new TestViewDefinitions())
  value.replaceWindow(entries, hasMore)
  value.flush()
  return value
}

function snapshot(value: ConversationNodeAssembler): ChatSnapshot {
  const current = value.snapshot('chat') as ChatSnapshot | undefined
  if (current === undefined) throw new Error('chat view was not registered')
  return current
}

function node(value: ChatSnapshot, kind: string): ChatConversationViewNode | undefined {
  return value.nodes.values().find((candidate) => candidate.kind === kind)
}

function wecomMessage(id: string, text: string, externalChatId: string) {
  return {
    id,
    role: 'user' as const,
    content: [{ type: 'text' as const, text }],
    source: { kind: 'wecom' as const, externalChatId },
  }
}

describe('wecom-customer-session conversation node', () => {
  it('folds a wecom/session marker and inbound messages into one card', () => {
    const value = assembler([
      at(1, 'wecom/session', { externalChatId: 'ext-1' }),
      at(2, 'user/message', wecomMessage('m1', '你好', 'ext-1')),
      at(3, 'user/message', wecomMessage('m2', '还有货吗', 'ext-1')),
    ])
    const card = node(snapshot(value), 'wecom-customer-session')
    expect(card).toBeDefined()
    expect(card?.data).toEqual({ externalChatId: 'ext-1', messageCount: 2, latestText: '还有货吗' })
    expect(card?.anchorSeq).toBe(1)
  })

  it('keeps a pending context until the wecom/session start arrives', () => {
    const value = assembler([
      at(3, 'user/message', wecomMessage('m2', '在吗', 'ext-2')),
    ])
    expect(node(snapshot(value), 'wecom-customer-session')).toBeUndefined()

    value.prepend([
      at(1, 'wecom/session', { externalChatId: 'ext-2' }),
      at(2, 'user/message', wecomMessage('m1', '你好', 'ext-2')),
    ], false)
    value.flush()
    const card = node(snapshot(value), 'wecom-customer-session')
    expect(card?.data).toMatchObject({ externalChatId: 'ext-2', messageCount: 2, latestText: '在吗' })
  })

  it('updates the card on a realtime append', () => {
    const value = assembler([
      at(1, 'wecom/session', { externalChatId: 'ext-3' }),
      at(2, 'user/message', wecomMessage('m1', '在吗', 'ext-3')),
    ])
    value.append(at(3, 'user/message', wecomMessage('m2', '价格？', 'ext-3'), { surfaceOp: 'append' }))
    value.flush()
    const card = node(snapshot(value), 'wecom-customer-session')
    expect(card?.data).toMatchObject({ externalChatId: 'ext-3', messageCount: 2, latestText: '价格？' })
  })
})
