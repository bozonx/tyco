import { describe, expect, it } from 'vitest'

import { createChatToolApprovals } from './chat-tool-approvals'

const request = (approvalId: string) => ({
  approvalId,
  toolCallId: `call-${approvalId}`,
  toolName: 'now',
  input: {},
  approvalKey: 'now',
})

describe('chat-tool-approvals', () => {
  it('waits for the answer to each request', async () => {
    const approvals = createChatToolApprovals()
    const signal = new AbortController().signal

    const first = approvals.request(request('a1'), signal)
    const second = approvals.request(request('a2'), signal)
    expect(approvals.pending.value.map((item) => item.approvalId)).toEqual([
      'a1',
      'a2',
    ])

    approvals.answer('a1', 'deny')
    approvals.answer('a2', 'allow-session')
    approvals.answer('a1', 'allow-once')

    expect(await first).toBe('deny')
    expect(await second).toBe('allow-session')
    expect(approvals.pending.value).toEqual([])
    expect(approvals.isPending('a1')).toBe(false)
  })

  it('refuses when the turn is stopped or the chat is left', async () => {
    const approvals = createChatToolApprovals()
    const controller = new AbortController()

    const stopped = approvals.request(request('a1'), controller.signal)
    controller.abort()
    expect(await stopped).toBe('deny')
    expect(await approvals.request(request('a2'), controller.signal)).toBe(
      'deny'
    )

    const left = approvals.request(request('a3'), new AbortController().signal)
    approvals.cancelAll()
    expect(await left).toBe('deny')
  })

  it('allows the waiting calls of the same key, and a batch at once', async () => {
    const approvals = createChatToolApprovals()
    const signal = new AbortController().signal
    const ask = (approvalId: string, extra: object) =>
      approvals.request({ ...request(approvalId), ...extra }, signal)

    const a = ask('a1', { approvalKey: 'k', batchId: 's' })
    const b = ask('a2', { approvalKey: 'k', batchId: 's' })
    const c = ask('a3', { approvalKey: 'other', batchId: 's' })
    approvals.answer('a1', 'allow-session')
    expect(await a).toBe('allow-session')
    expect(await b).toBe('allow-once')
    expect(approvals.isPending('a3')).toBe(true)

    const d = ask('a4', { approvalKey: 'x', batchId: 't' })
    approvals.answer('a3', 'allow-batch')
    expect(await c).toBe('allow-once')
    expect(approvals.isPending('a4')).toBe(true)
    approvals.answer('a4', 'deny')
    expect(await d).toBe('deny')
  })

  it('keeps other calls to the same target pending after a one-time approval', async () => {
    const approvals = createChatToolApprovals()
    const signal = new AbortController().signal
    const a = approvals.request(
      { ...request('a1'), approvalKey: 'k1', leakTarget: 'host:x' },
      signal
    )
    const b = approvals.request(
      { ...request('a2'), approvalKey: 'k2', leakTarget: 'host:x' },
      signal
    )
    approvals.answer('a1', 'allow-once')
    expect(await a).toBe('allow-once')
    expect(approvals.isPending('a2')).toBe(true)
    approvals.answer('a2', 'deny')
    expect(await b).toBe('deny')
  })
})
