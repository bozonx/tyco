import { DESKTOP_COMMANDS, type DesktopCommandArgs } from '@tyco/shared'
import type { ExternalFunctions } from './functions/external'
import type { DomainCommandMap } from './command-types'

export function createExternalCommandMap(): DomainCommandMap<
  keyof ExternalFunctions
> {
  return {
    answerExternalAccess: {
      command: DESKTOP_COMMANDS.ANSWER_EXTERNAL_ACCESS,
      buildArgs: ([jobId, decision]) =>
        ({
          jobId,
          decision,
        }) satisfies DesktopCommandArgs<'answer_external_access'>,
    },
    claimExternalJob: {
      command: DESKTOP_COMMANDS.CLAIM_EXTERNAL_JOB,
      buildArgs: ([id]) =>
        ({ id }) satisfies DesktopCommandArgs<'claim_external_job'>,
    },
    finishExternalJob: {
      command: DESKTOP_COMMANDS.FINISH_EXTERNAL_JOB,
      buildArgs: ([id, completion]) =>
        ({
          id,
          completion,
        }) satisfies DesktopCommandArgs<'finish_external_job'>,
    },
  }
}
