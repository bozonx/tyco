import type { AccessDecision } from '@tyco/shared'

export interface ExternalFunctions {
  answerExternalAccess: { args: [jobId: string, decision: AccessDecision] }
  claimExternalJob: { args: [id: string] }
  finishExternalJob: {
    args: [
      id: string,
      completion: {
        success: boolean
        cancelled?: boolean
        output?: string
        message?: string
        code?: string
      },
    ]
  }
}
