/**
 * Client-safe durable type augmentations for the WeCom channel. Contains ONLY
 * shared event/message type merges — no cordis `Context` augmentation — so both
 * the host and the browser face can import it without violating the client/host
 * program split.
 * @module @deepseek-ai/dsh-wecom-channel/session-events
 */

declare module '@deepseek-ai/dsh-llm' {
  interface MessageSourceMap {
    /** An inbound message from an external WeCom customer chat. */
    wecom: { kind: 'wecom'; externalChatId: string }
  }
}

declare module '@deepseek-ai/dsh-session/types' {
  interface SessionEventMap {
    /**
     * Marks the session as a WeCom external-customer conversation. Emitted once
     * by the channel driver when a customer session is created, before its first
     * inbound message. A display/identity fact, not model-visible, so it needs
     * no surface rendering.
     */
    'wecom/session': { externalChatId: string; displayName?: string }
  }
}

// Makes this file a module so its type merges travel through an import (the
// client and host both `import type {}` this path to load the augmentations).
export {}
