import { afterEach, describe, expect, it, vi } from 'vitest'
import { InProcMessageBus } from '../../src/modules/pubsub/in-proc.js'

describe('InProcMessageBus', () => {
  let bus: InProcMessageBus

  afterEach(() => {
    bus?.removeAllSubscribers()
  })

  it('delivers a published payload to a subscriber on the same channel', () => {
    bus = new InProcMessageBus()
    const handler = vi.fn()
    bus.subscribe('ch1', handler)
    bus.publish('ch1', { foo: 'bar' })
    expect(handler).toHaveBeenCalledOnce()
    expect(handler).toHaveBeenCalledWith({ foo: 'bar' })
  })

  it('does NOT deliver to a different channel', () => {
    bus = new InProcMessageBus()
    const handler = vi.fn()
    bus.subscribe('ch1', handler)
    bus.publish('ch2', { foo: 'bar' })
    expect(handler).not.toHaveBeenCalled()
  })

  it('delivers to all subscribers of a channel', () => {
    bus = new InProcMessageBus()
    const h1 = vi.fn()
    const h2 = vi.fn()
    bus.subscribe('ch1', h1)
    bus.subscribe('ch1', h2)
    bus.publish('ch1', 'hi')
    expect(h1).toHaveBeenCalledOnce()
    expect(h1).toHaveBeenCalledWith('hi')
    expect(h2).toHaveBeenCalledOnce()
    expect(h2).toHaveBeenCalledWith('hi')
  })

  it('unsubscribe returned by subscribe stops delivery to that handler only', () => {
    bus = new InProcMessageBus()
    const h1 = vi.fn()
    const h2 = vi.fn()
    const off1 = bus.subscribe('ch1', h1)
    bus.subscribe('ch1', h2)
    off1()
    bus.publish('ch1', 'hi')
    expect(h1).not.toHaveBeenCalled()
    expect(h2).toHaveBeenCalledOnce()
    expect(h2).toHaveBeenCalledWith('hi')
  })
})
