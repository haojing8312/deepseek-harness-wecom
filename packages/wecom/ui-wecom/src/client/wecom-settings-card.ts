import { createElement, useEffect, useState, type ReactNode } from 'react'
import type { SettingsScope } from '@deepseek-ai/dsh-client-runtime/client'

/** WeCom workbench injection configuration edited by the settings card. */
export interface WecomSettingsValue {
  /** Active channel adapter. */
  adapter?: 'mock' | 'vworkapi'
  /** Installed WeCom PC client path, for DLL injection. */
  wecomClientPath?: string
  /** Pinned WeCom client version the injection targets. */
  wecomVersion?: string
  /** Whether inbound customer messages auto-reply. */
  autoReply?: boolean
  /** Per-customer outbound message rate cap per minute. */
  rateLimitPerMinute?: number
}

/** Injected seat the plugin binds the wecom settings scope into. */
export interface WecomSettingsInjected {
  scope: SettingsScope<WecomSettingsValue>
}

/** The namespace this card edits; spelled here, never imported from a Host package. */
export const WECOM_SETTINGS_NS = 'wecom'

function fieldRow(label: string, control: ReactNode): ReactNode {
  return createElement('label', { className: 'wecom-settings-field' },
    createElement('span', null, label),
    control,
  )
}

/** Self-contained keyed renderer for the wecom plugin settings card. */
export function WecomSettingsCard({ scope }: WecomSettingsInjected) {
  const [value, setValue] = useState<WecomSettingsValue>(() => ({ ...(scope.getSnapshot().value ?? {}) }))
  useEffect(() => scope.subscribe(() => {
    setValue((prev) => ({ ...prev, ...(scope.getSnapshot().value ?? {}) }))
  }), [scope])

  const patch = (field: Partial<WecomSettingsValue>): void => setValue((prev) => ({ ...prev, ...field }))

  const save = (): void => {
    void scope.set('adapter', value.adapter ?? 'mock')
    void scope.set('wecomClientPath', value.wecomClientPath ?? '')
    void scope.set('wecomVersion', value.wecomVersion ?? '')
    void scope.set('autoReply', value.autoReply ?? true)
    void scope.set('rateLimitPerMinute', value.rateLimitPerMinute ?? 20)
  }

  return createElement('section', { className: 'wecom-settings-card' },
    createElement('h3', null, '企微销冠工作台'),
    fieldRow('适配器', createElement('select', {
      value: value.adapter ?? 'mock',
      onChange: (event: { target: { value: string } }) => patch({ adapter: event.target.value as 'mock' | 'vworkapi' }),
    },
    createElement('option', { value: 'mock' }, 'mock（开发）'),
    createElement('option', { value: 'vworkapi' }, 'vworkapi（DLL 注入）'),
    )),
    fieldRow('企微客户端路径', createElement('input', {
      type: 'text',
      value: value.wecomClientPath ?? '',
      onChange: (event: { target: { value: string } }) => patch({ wecomClientPath: event.target.value }),
    })),
    fieldRow('企微版本', createElement('input', {
      type: 'text',
      value: value.wecomVersion ?? '',
      onChange: (event: { target: { value: string } }) => patch({ wecomVersion: event.target.value }),
    })),
    fieldRow('自动回复', createElement('input', {
      type: 'checkbox',
      checked: value.autoReply ?? true,
      onChange: (event: { target: { checked: boolean } }) => patch({ autoReply: event.target.checked }),
    })),
    fieldRow('限速（条/分钟）', createElement('input', {
      type: 'number',
      min: 0,
      value: value.rateLimitPerMinute ?? 20,
      onChange: (event: { target: { value: string } }) => patch({ rateLimitPerMinute: Number(event.target.value) }),
    })),
    createElement('button', { className: 'wecom-settings-save', onClick: save }, '保存'),
  )
}
