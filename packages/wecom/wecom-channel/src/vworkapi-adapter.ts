/**
 * Real WeCom channel adapter over the vworkApi.dll HTTP dual-channel protocol
 * (remote-thread injection into the pinned WeCom PC client; a local HTTP API
 * for commands, a callback server for inbound events). Implements the same
 * {@link WecomChannelAdapter} seam as the mock, so swapping is a provider
 * replacement. Protocol details are documented in
 * `_reference/WeiClaw-analysis/WeiClaw技术方案.md` §3.
 * @module @deepseek-ai/dsh-wecom-channel/vworkapi-adapter
 */

import { createServer, type Server } from 'node:http'
import { spawn } from 'node:child_process'
import type { Context } from '@deepseek-ai/cordis'
import type {
  WecomChannelAdapter, WecomChannelAdapterStatus, WecomInboundMessage,
} from './types.ts'

export const name = 'wecom-adapter-vworkapi'

/** Provide `ctx.wecomAdapter` backed by the real vworkApi injection adapter. */
export function apply(ctx: Context, config: VworkApiAdapterConfig): void {
  ctx.provide('wecomAdapter', createVworkApiAdapter(config))
}

/** The professional vworkApi license key shipped with the authorized DLL (D-4). */
export const VWORKAPI_DEFAULT_KEY =
  'RL7pWlWf1F5CWQcOSnszqGXhS1Tn2dRGawd2HoF+8vbb9Zw7XWQnNXpuKFrgi0NN'

/** vworkApi command codes used by this adapter. */
export const VWORK_CMD_SEND_TEXT = 3000
export const VWORK_CMD_PROCESS_PID = 10004

/** vworkApi callback event types. */
export const VWORK_CALLBACK_MESSAGE = 100

/** vworkApi message types. */
export const VWORK_MSG_TEXT = 2

/** Configuration for one vworkApi adapter instance. */
export interface VworkApiAdapterConfig {
  /** The DLL's local HTTP API port (default 8989; multiple accounts increment). */
  dllPort?: number
  /** Local callback port the DLL posts inbound events to (default 9000). */
  callbackPort?: number
  /** Path to `inject_tool.exe`. */
  injectToolPath?: string
  /** vworkApi license key; defaults to {@link VWORKAPI_DEFAULT_KEY}. */
  key?: string
  /** Optional explicit WeCom client executable path for injection. */
  wecomExePath?: string
  /** Optional Bearer token the callback server verifies; any token when absent. */
  callbackToken?: string
  /** Bridge-reachability timeout during start (default 30s). */
  timeoutMs?: number
  /** Skip the inject_tool spawn (unit tests / diagnostics against a live bridge). */
  skipInject?: boolean
}

const delay = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms))

/** One vworkApi HTTP API call with a bounded timeout. */
async function callApi(
  port: number,
  body: unknown,
  timeoutMs: number,
): Promise<{ errno: number; errmsg?: string; data?: unknown }> {
  const response = await fetch(`http://127.0.0.1:${port}/api`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(timeoutMs),
  })
  if (!response.ok) throw new Error(`vworkApi /api responded ${response.status}`)
  return await response.json() as { errno: number; errmsg?: string; data?: unknown }
}

/** Parse one vworkApi callback payload into an inbound message, when it is one. */
function messageFromCallback(payload: unknown, selfUserId: string | undefined): WecomInboundMessage | undefined {
  const root = payload as { type?: unknown; self_user_id?: unknown; message?: Record<string, unknown> }
  if (root.type !== VWORK_CALLBACK_MESSAGE) return undefined
  const msg = (root.message ?? payload) as { user_id?: unknown; msg_type?: unknown; content?: unknown }
  if (msg.msg_type !== VWORK_MSG_TEXT) return undefined
  if (typeof msg.user_id !== 'string' || msg.user_id === '') return undefined
  if (selfUserId !== undefined && msg.user_id === selfUserId) return undefined
  const text = typeof msg.content === 'string' ? msg.content.trim() : ''
  if (text === '') return undefined
  return { externalChatId: msg.user_id, text }
}

/**
 * Build a real vworkApi-backed channel adapter.
 * @param config - injection + protocol configuration.
 * @returns the adapter, plus the callback server handle for tests.
 */
export function createVworkApiAdapter(config: VworkApiAdapterConfig): WecomChannelAdapter & {
  /** Start the callback HTTP server alone (tests); started by `start()` otherwise. */
  startCallbackServer(): Promise<Server>
  /** The callback server, once started. */
  readonly callbackServer: Server | undefined
} {
  const dllPort = config.dllPort ?? 8989
  const callbackPort = config.callbackPort ?? 9000
  const key = config.key ?? VWORKAPI_DEFAULT_KEY
  const timeoutMs = config.timeoutMs ?? 30_000
  let status: WecomChannelAdapterStatus = 'disconnected'
  let callbackServer: Server | undefined
  const handlers: ((message: WecomInboundMessage) => Promise<void>)[] = []
  // The DLL's HTTP service is single-threaded: serialize calls and let it rest.
  let chain: Promise<unknown> = Promise.resolve()

  async function startCallbackServer(): Promise<Server> {
    if (callbackServer !== undefined) return callbackServer
    const server = createServer((req, res) => {
      let body = ''
      req.setEncoding('utf8')
      req.on('data', (chunk: string) => { body += chunk })
      req.on('end', () => {
        // ACK first, always — vworkApi resends/alert on callback timeout.
        res.writeHead(200, { 'Content-Type': 'application/json' })
        res.end('{"errno":0,"errmsg":""}')
        if (req.method !== 'POST') return
        const expected = config.callbackToken
        if (expected !== undefined && req.headers.authorization !== `Bearer ${expected}`) return
        let payload: unknown
        try {
          payload = JSON.parse(body)
        } catch {
          return
        }
        const selfUserId = (payload as { self_user_id?: unknown }).self_user_id as string | undefined
        const message = messageFromCallback(payload, selfUserId)
        if (message === undefined) return
        for (const handler of handlers) void handler(message)
      })
    })
    server.on('error', () => { status = 'offline' })
    server.listen(callbackPort, '127.0.0.1')
    await new Promise<void>((resolve, reject) => {
      server.once('listening', () => resolve())
      server.once('error', reject)
    })
    callbackServer = server
    return server
  }

  async function waitForBridge(): Promise<void> {
    const deadline = Date.now() + timeoutMs
    while (Date.now() < deadline) {
      try {
        await callApi(dllPort, { type: VWORK_CMD_PROCESS_PID }, 2000)
        return
      } catch {
        await delay(500)
      }
    }
    throw new Error(`vworkApi bridge on :${dllPort} did not become reachable within ${timeoutMs}ms`)
  }

  const adapter: WecomChannelAdapter & {
    startCallbackServer(): Promise<Server>
    readonly callbackServer: Server | undefined
  } = {
    id: 'vworkapi',
    get status() {
      return status
    },
    get callbackServer() {
      return callbackServer
    },
    startCallbackServer,
    async start() {
      status = 'connecting'
      try {
        await startCallbackServer()
        if (!config.skipInject) {
          const args = ['start', String(dllPort), `--key=${key}`]
          if (config.callbackPort !== undefined) args.push(`--my_port=${String(config.callbackPort)}`)
          if (config.wecomExePath !== undefined) args.push(`--exe_path=${config.wecomExePath}`)
          if (config.injectToolPath === undefined) {
            throw new Error('vworkapi adapter requires injectToolPath (path to inject_tool.exe)')
          }
          const child = spawn(config.injectToolPath, args, { stdio: 'ignore' })
          child.on('error', (error) => { status = 'offline'; throw error })
          child.unref()
          await waitForBridge()
        }
        status = 'online'
      } catch (error) {
        status = 'offline'
        throw error
      }
    },
    async stop() {
      if (callbackServer !== undefined) {
        await new Promise<void>((resolve) => callbackServer?.close(() => resolve()))
        callbackServer = undefined
      }
      status = 'disconnected'
    },
    async sendText(externalChatId, text) {
      const run = async (): Promise<void> => {
        const result = await callApi(dllPort, {
          type: VWORK_CMD_SEND_TEXT,
          port: dllPort,
          user_id: externalChatId,
          msg: text,
        }, timeoutMs)
        if (result.errno !== 0) {
          throw new Error(`vworkApi send failed: ${result.errno} ${result.errmsg ?? ''}`)
        }
      }
      chain = chain.then(run, run).then(() => delay(120), () => delay(120))
      return chain as Promise<void>
    },
    onMessage(handler) {
      handlers.push(handler)
    },
  }

  return adapter
}
