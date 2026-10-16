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

    approvals.answer('a2', 'allow-session')
    approvals.answer('a1', 'deny')
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
})
