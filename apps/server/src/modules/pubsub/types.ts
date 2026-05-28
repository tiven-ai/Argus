export type MessageHandler = (payload: unknown) => void

export interface MessageBus {
  /** Publish a payload to all subscribers of the channel. Returns synchronously after dispatch. */
  publish(channel: string, payload: unknown): void

  /** Subscribe to a channel. Returns an unsubscribe function. */
  subscribe(channel: string, handler: MessageHandler): () => void

  /** Remove all subscribers from all channels (testing/teardown helper). */
  removeAllSubscribers(): void
}
