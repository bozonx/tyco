import type { AccessDecision } from '@tyco/shared'

export interface AccessPromptDeps {
  answer: (jobId: string, decision: AccessDecision) => Promise<void>
}

/**
 * Sends one answer per request: whatever comes after it, a second click, Esc or
 * the prompt going away when the window hides, does nothing
 */
export function createAccessPrompt(deps: AccessPromptDeps) {
  const answered = new Set<string>()

  const respond = (jobId: string | undefined, decision: AccessDecision) => {
    if (!jobId || answered.has(jobId)) return
    answered.add(jobId)
    // a failed answer leaves the job to its timeout, which tells the caller
    void deps.answer(jobId, decision).catch(() => {})
  }

  return {
    respond,
    isAnswered: (jobId: string | undefined) =>
      Boolean(jobId && answered.has(jobId)),
    /** The prompt went away without an answer: the call is denied */
    dismiss: (jobId: string | undefined) => respond(jobId, 'deny'),
  }
}
