import { createServer, request, type Server } from 'node:http'
import { describe, expect, it } from 'vitest'
import { createVworkApiAdapter } from '../src/vworkapi-adapter.ts'
import type { WecomInboundMessage } from '../src/types.ts'

/** A fake vworkApi /api HTTP endpoint that records the last command body. */
async function fakeApi(): Promise<{ server: Server; last: () => unknown; port: () => number }> {
  let body: unknown
  const server = createServer((req, res) => {
    let raw = ''
    req.setEncoding('utf8')
    req.on('data', (chunk: string) => { raw += chunk })
    req.on('end', () => {
      body = raw === '' ? undefined : JSON.parse(raw)
      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.end('{"errno":0,"errmsg":"","data":{}}')
    })
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()))
  const address = server.address() as { port: number }
  return {
    server,
    last: () => body,
    port: () => address.port,
  }
}

function postJson(server: Server, path: string, payload: unknown, token?: string): Promise<void> {
  const port = (server.address() as { port: number }).port
  return new Promise((resolve, reject) => {
    const req = request({
      host: '127.0.0.1',
      port,
      path,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(token === undefined ? {} : { Authorization: `Bearer ${token}` }),
      },
    }, (res: { on: (e: string, cb: () => void) => void }) => {
      res.on('data', () => {})
      res.on('end', () => resolve())
    })
    req.on('error', reject)
    req.end(JSON.stringify(payload))
  })
}

describe('vworkapi adapter', () => {
  it('sends a text command to the DLL API with the external chat id as user_id', async () => {
    const api = await fakeApi()
    const adapter = createVworkApiAdapter({ dllPort: api.port(), skipInject: true })
    try {
      await adapter.sendText('ext-9', '您好')
      expect(api.last()).toEqual({ type: 3000, port: api.port(), user_id: 'ext-9', msg: '您好' })
    } finally {
      await api.server.close()
    }
  })

  it('forwards a callback text message to the registered handler', async () => {
    const adapter = createVworkApiAdapter({ callbackPort: 0, skipInject: true })
    const received: WecomInboundMessage[] = []
    adapter.onMessage(async (message) => { received.push(message) })
    try {
      const server = await adapter.startCallbackServer()
      await postJson(server, '/msg', {
        type: 100,
        self_user_id: 'me',
        message: { user_id: 'ext-5', msg_type: 2, content: '你好', msg_id: 'm1' },
      })
      await new Promise((resolve) => setTimeout(resolve, 50))
      expect(received).toEqual([{ externalChatId: 'ext-5', text: '你好' }])
    } finally {
      await adapter.stop()
    }
  })

  it('skips self echoes and non-text messages', async () => {
    const adapter = createVworkApiAdapter({ callbackPort: 0, skipInject: true })
    const received: WecomInboundMessage[] = []
    adapter.onMessage(async (message) => { received.push(message) })
    try {
      const server = await adapter.startCallbackServer()
      await postJson(server, '/msg', {
        type: 100,
        self_user_id: 'me',
        message: { user_id: 'me', msg_type: 2, content: '自己的回显', msg_id: 'm2' },
      })
      await postJson(server, '/msg', {
        type: 100,
        self_user_id: 'me',
        message: { user_id: 'ext-6', msg_type: 14, content: 'image', msg_id: 'm3' },
      })
      await new Promise((resolve) => setTimeout(resolve, 50))
      expect(received).toEqual([])
    } finally {
      await adapter.stop()
    }
  })

  it('drops our own sent replies echoing back (is_self_msg)', async () => {
    const adapter = createVworkApiAdapter({ callbackPort: 0, skipInject: true })
    const received: WecomInboundMessage[] = []
    adapter.onMessage(async (message) => { received.push(message) })
    try {
      const server = await adapter.startCallbackServer()
      await postJson(server, '/msg', {
        type: 100,
        self_user_id: 'me',
        message: { user_id: 'ext-8', msg_type: 2, content: '我发的回复', msg_id: 'm5', is_self_msg: 1 },
      })
      await new Promise((resolve) => setTimeout(resolve, 50))
      expect(received).toEqual([])
    } finally {
      await adapter.stop()
    }
  })

  it('rejects a callback with a mismatched bearer token when one is configured', async () => {
    const adapter = createVworkApiAdapter({ callbackPort: 0, callbackToken: 'secret', skipInject: true })
    const received: WecomInboundMessage[] = []
    adapter.onMessage(async (message) => { received.push(message) })
    try {
      const server = await adapter.startCallbackServer()
      await postJson(server, '/msg', {
        type: 100,
        self_user_id: 'me',
        message: { user_id: 'ext-7', msg_type: 2, content: '你好', msg_id: 'm4' },
      }, 'wrong-token')
      await new Promise((resolve) => setTimeout(resolve, 50))
      expect(received).toEqual([])
    } finally {
      await adapter.stop()
    }
  })
})
