import { ref } from 'vue'

import type { ChatToolApprovalRequest } from './chat-tool-loop'
import type { ChatToolDecision } from './chat-tool-policy'

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

  const settle = (approvalId: string, decision: ChatToolDecision) => {
    const entry = waiting.get(approvalId)
    if (!entry) return
    waiting.delete(approvalId)
    pending.value = pending.value.filter(
      (request) => request.approvalId !== approvalId
    )
    entry.resolve(decision)
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
    isPending: (approvalId: string) => waiting.has(approvalId),
    /** Refuses everything that still waits, e.g. when the chat is left */
    cancelAll: () => {
      for (const approvalId of [...waiting.keys()]) settle(approvalId, 'deny')
    },
  }
}

export type ChatToolApprovals = ReturnType<typeof createChatToolApprovals>
