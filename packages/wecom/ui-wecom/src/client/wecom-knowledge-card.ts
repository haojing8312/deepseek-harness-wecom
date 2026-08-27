import { createElement, useEffect, useState } from 'react'

/** One knowledge file surfaced by the remote. */
export interface KnowledgeFileEntry {
  readonly path: string
  readonly size: number
}

/** Knowledge operations unwrapped from the client remote. */
export interface WecomKnowledgeOps {
  list(): Promise<KnowledgeFileEntry[]>
  read(path: string): Promise<{ content: string }>
  write(path: string, content: string): Promise<void>
  delete(path: string): Promise<void>
}

/** Injected seat the plugin binds the wecom knowledge remote into. */
export interface WecomKnowledgeInjected {
  knowledge: WecomKnowledgeOps
}

/** Key under which the card registers in the settings.plugin.item slot. */
export const WECOM_KNOWLEDGE_NS = 'wecom-knowledge'

/** Self-contained keyed renderer for the customer knowledge base manager. */
export function WecomKnowledgeCard({ knowledge }: WecomKnowledgeInjected) {
  const [files, setFiles] = useState<KnowledgeFileEntry[] | undefined>(undefined)
  const [selected, setSelected] = useState<string | undefined>(undefined)
  const [content, setContent] = useState('')
  const [dirty, setDirty] = useState(false)
  const [error, setError] = useState<string | undefined>(undefined)

  const run = async (operation: () => Promise<void>): Promise<void> => {
    setError(undefined)
    try {
      await operation()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    }
  }

  useEffect(() => {
    void run(async () => { setFiles(await knowledge.list()) })
  }, [knowledge])

  const open = (path: string): void => {
    void run(async () => {
      setSelected(path)
      setContent((await knowledge.read(path)).content)
      setDirty(false)
    })
  }
  const save = (): void => {
    if (selected === undefined) return
    void run(async () => {
      await knowledge.write(selected, content)
      setDirty(false)
      setFiles(await knowledge.list())
    })
  }
  const createFile = (): void => {
    const name = window.prompt('新知识文件名（.md 或 .txt）')
    if (name === null || name.trim() === '') return
    void run(async () => {
      await knowledge.write(name.trim(), `# ${name.trim()}\n`)
      setFiles(await knowledge.list())
      await open(name.trim())
    })
  }
  const remove = (path: string): void => {
    if (!window.confirm(`删除 ${path} ？`)) return
    void run(async () => {
      await knowledge.delete(path)
      if (selected === path) {
        setSelected(undefined)
        setContent('')
      }
      setFiles(await knowledge.list())
    })
  }

  return createElement('section', { className: 'wecom-knowledge-card' },
    createElement('header', null,
      createElement('h3', null, '客户知识库'),
      createElement('button', { onClick: () => createFile() }, '新建'),
    ),
    error === undefined ? null : createElement('p', { className: 'wecom-knowledge-error' }, error),
    createElement('div', { className: 'wecom-knowledge-body' },
      createElement('ul', { className: 'wecom-knowledge-files' },
        ...(files ?? []).map((file) => createElement('li', { key: file.path },
          createElement('button', {
            className: file.path === selected ? 'selected' : '',
            onClick: () => open(file.path),
          }, file.path),
          createElement('button', { className: 'wecom-knowledge-delete', onClick: () => remove(file.path) }, '✕'),
        )),
      ),
      createElement('div', { className: 'wecom-knowledge-editor' },
        createElement('textarea', {
          value: content,
          placeholder: selected === undefined ? '选择左侧文件开始编辑' : '',
          readOnly: selected === undefined,
          onChange: (event: { target: { value: string } }) => {
            setContent(event.target.value)
            setDirty(true)
          },
        }),
        createElement('div', { className: 'wecom-knowledge-actions' },
          createElement('button', { disabled: selected === undefined || !dirty, onClick: save }, '保存'),
          createElement('span', null, selected === undefined ? '未选择文件' : dirty ? '有未保存修改' : '已保存'),
        ),
      ),
    ),
  )
}
