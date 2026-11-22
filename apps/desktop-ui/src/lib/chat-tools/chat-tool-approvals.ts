import { ref } from 'vue'

import type { ChatToolApprovalRequest } from './chat-tool-loop'
import type { ChatToolAnswer, ChatToolDecision } from './chat-tool-policy'

interface PendingApproval {
  request: ChatToolApprovalRequest
  resolve: (decision: ChatToolDecision) => void
}

/**
 * The tool calls of a chat that wait for the user. The chat shows them in the
 * message; nothing else of the interface is blocked while they wait
 */
export function createChatToolApprovals() {
  const pending = ref<ChatToolApprovalRequest[]>([])
  const waiting = new Map<string, PendingApproval>()

  const settleOne = (approvalId: string, decision: ChatToolDecision) => {
    const entry = waiting.get(approvalId)
    if (!entry) return undefined
    waiting.delete(approvalId)
    pending.value = pending.value.filter(
      (request) => request.approvalId !== approvalId
    )
    entry.resolve(decision)
    return entry.request
  }

  /**
   * Answers a call. Allowing it for the chat or for good answers the calls
   * waiting with the same key too, as allowing a leak target in any way does
   * for the calls to that target
   */
  const settle = (approvalId: string, answer: ChatToolAnswer) => {
    if (answer === 'allow-batch') {
      const batchId = waiting.get(approvalId)?.request.batchId
      if (batchId) settleBatch(batchId, 'allow-once')
      else settleOne(approvalId, 'allow-once')
      return
    }
    const decision = answer
    const request = settleOne(approvalId, decision)
    if (!request || decision === 'deny') return
    // allowing a leak target once allows it for the chat
    if (decision === 'allow-once' && !request.leakTarget) return
    for (const other of [...waiting.values()].map((entry) => entry.request)) {
      const isSame = request.leakTarget
        ? other.leakTarget === request.leakTarget
        : !other.leakTarget && other.approvalKey === request.approvalKey
      if (isSame) settleOne(other.approvalId, 'allow-once')
    }
  }

  /** Answers every call of a batch that still waits */
  const settleBatch = (batchId: string, decision: 'allow-once' | 'deny') => {
    for (const entry of [...waiting.values()])
      if (entry.request.batchId === batchId)
        settleOne(entry.request.approvalId, decision)
  }

  /** Waits for the user's answer; an aborted turn is a refusal */
  const request = (
    approval: ChatToolApprovalRequest,
    signal: AbortSignal
  ): Promise<ChatToolDecision> => {
    if (signal.aborted) return Promise.resolve('deny')
    return new Promise((resolve) => {
      waiting.set(approval.approvalId, { request: approval, resolve })
      pending.value = [...pending.value, approval]
      signal.addEventListener(
        'abort',
        () => settle(approval.approvalId, 'deny'),
        { once: true }
      )
    })
  }

  return {
    /** The requests on screen, oldest first */
    pending,
    request,
    answer: settle,
    answerBatch: settleBatch,
    isPending: (approvalId: string) => waiting.has(approvalId),
    /** Refuses everything that still waits, e.g. when the chat is left */
    cancelAll: () => {
      for (const approvalId of [...waiting.keys()])
        settleOne(approvalId, 'deny')
    },
  }
}
