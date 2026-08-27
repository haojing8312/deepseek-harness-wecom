/**
 * WeCom channel remote: connection status plus read/write access to the customer
 * knowledge base for the Web UI management card. Mounted as its own plugin row
 * so it survives the driver; it reads host-plane services through the global
 * service store.
 * @module @deepseek-ai/dsh-wecom-channel/gateway
 */

import { mkdir, readdir, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { isAbsolute, join, relative, resolve, sep } from 'node:path'
import type { Context } from '@deepseek-ai/cordis'
import { Remote, TypertRemoteService } from '@deepseek-ai/dsh-typert-protocol'
import type { WecomChannelAdapterStatus, WecomChannelStatusSnapshot } from './status.ts'

/** One knowledge file, addressed by its root-relative path. */
export interface KnowledgeFileEntry {
  /** Root-relative path with `/` separators. */
  readonly path: string
  /** File size in bytes. */
  readonly size: number
}

/** Reject a path that would escape the knowledge root. */
function assertInsideRoot(root: string, path: string): string {
  const target = resolve(root, path)
  const rel = relative(root, target)
  if (rel === '..' || rel.startsWith(`..${sep}`) || isAbsolute(rel)) {
    throw new Error(`knowledge path escapes the knowledge root: ${path}`)
  }
  return target
}

async function listKnowledge(root: string): Promise<KnowledgeFileEntry[]> {
  const entries: KnowledgeFileEntry[] = []
  for (const file of await readdir(root, { recursive: true })) {
    if (!file.endsWith('.md') && !file.endsWith('.txt')) continue
    const info = await stat(join(root, file))
    entries.push({ path: file.split(sep).join('/'), size: info.size })
  }
  return entries.sort((a, b) => a.path.localeCompare(b.path))
}

/** Remote-only service exposing WeCom channel status and knowledge operations. */
export class WecomChannelGateway extends TypertRemoteService {
  constructor(ctx: Context) {
    super(ctx, 'wecomChannel')
  }

  /** Read the adapter's live connection status. */
  @Remote('status')
  status(): WecomChannelStatusSnapshot {
    const adapter = this.ctx.get('wecomAdapter') as
      | { readonly id: string; readonly status: WecomChannelAdapterStatus }
      | undefined
    if (adapter === undefined) return { adapterId: 'none', status: 'disconnected' }
    return { adapterId: adapter.id, status: adapter.status }
  }

  /** The configured knowledge root (absolute), from the channel driver. */
  private knowledgeRoot(): string {
    const service = this.ctx.get('wecomChannelService') as { readonly knowledgeRoot?: string } | undefined
    if (service?.knowledgeRoot === undefined) {
      throw new Error('wecomChannelService.knowledgeRoot is not configured')
    }
    return service.knowledgeRoot
  }

  /** List the knowledge files under the root. */
  @Remote('knowledgeList')
  knowledgeList(): Promise<KnowledgeFileEntry[]> {
    return listKnowledge(this.knowledgeRoot())
  }

  /** Read one knowledge file's full content. */
  @Remote('knowledgeRead')
  knowledgeRead(path: string): Promise<{ content: string }> {
    const target = assertInsideRoot(this.knowledgeRoot(), path)
    return readFile(target, 'utf8').then((content) => ({ content }))
  }

  /** Create or overwrite one knowledge file (parent directories are created). */
  @Remote('knowledgeWrite')
  knowledgeWrite(path: string, content: string): Promise<{ ok: true }> {
    const root = this.knowledgeRoot()
    const target = assertInsideRoot(root, path)
    return mkdir(join(target, '..'), { recursive: true }).then(() => writeFile(target, content, 'utf8')).then(() => ({ ok: true }))
  }

  /** Delete one knowledge file. */
  @Remote('knowledgeDelete')
  knowledgeDelete(path: string): Promise<{ ok: true }> {
    const target = assertInsideRoot(this.knowledgeRoot(), path)
    return rm(target, { force: true }).then(() => ({ ok: true }))
  }
}

export default WecomChannelGateway
