import { EventEmitter } from 'node:events'
import type { MessageBus, MessageHandler } from './types.js'

export class InProcMessageBus implements MessageBus {
  private readonly emitter = new EventEmitter()

  constructor() {
    // Default limit (10) is fine for M3 — each SSE connection adds 1 listener.
    // Bump only if a single session has hundreds of concurrent watchers.
    this.emitter.setMaxListeners(100)
  }

  publish(channel: string, payload: unknown): void {
    this.emitter.emit(channel, payload)
  }

  subscribe(channel: string, handler: MessageHandler): () => void {
    this.emitter.on(channel, handler)
    return () => {
      this.emitter.off(channel, handler)
    }
  }

  removeAllSubscribers(): void {
    this.emitter.removeAllListeners()
  }
}
