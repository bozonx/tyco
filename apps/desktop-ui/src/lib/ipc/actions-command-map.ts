import { DESKTOP_COMMANDS, type DesktopCommandArgs } from '@tyco/shared'
import type { ActionsFunctions } from './functions/actions'
import type { DomainCommandMap } from './command-types'

export function createActionsCommandMap(): DomainCommandMap<
  keyof ActionsFunctions
> {
  return {
    finishSelectionRun: {
      command: DESKTOP_COMMANDS.FINISH_SELECTION_RUN,
      buildArgs: ([runId, text]) =>
        ({ runId, text }) satisfies DesktopCommandArgs<'finish_selection_run'>,
    },
    showStatusOverlay: {
      command: DESKTOP_COMMANDS.SHOW_STATUS_OVERLAY,
      buildArgs: ([request]) =>
        ({ request }) satisfies DesktopCommandArgs<'show_status_overlay'>,
    },
    notifyDesktop: {
      command: DESKTOP_COMMANDS.NOTIFY_DESKTOP,
      buildArgs: ([summary, body]) =>
        ({ summary, body }) satisfies DesktopCommandArgs<'notify_desktop'>,
    },
    checkTextInjection: { command: DESKTOP_COMMANDS.CHECK_TEXT_INJECTION },
    saveNote: {
      command: DESKTOP_COMMANDS.SAVE_NOTE,
      buildArgs: ([dir, fileName, text]) =>
        ({ dir, fileName, text }) satisfies DesktopCommandArgs<'save_note'>,
    },
    appendNote: {
      command: DESKTOP_COMMANDS.APPEND_NOTE,
      buildArgs: ([dir, fileName, text]) =>
        ({ dir, fileName, text }) satisfies DesktopCommandArgs<'append_note'>,
    },
    executeScriptAction: {
      command: DESKTOP_COMMANDS.EXECUTE_SCRIPT_ACTION,
      buildArgs: ([request]) =>
        ({ request }) satisfies DesktopCommandArgs<'execute_script_action'>,
    },
    cancelScriptAction: {
      command: DESKTOP_COMMANDS.CANCEL_SCRIPT_ACTION,
      buildArgs: ([runId]) =>
        ({ runId }) satisfies DesktopCommandArgs<'cancel_script_action'>,
    },
    pickScriptFile: { command: DESKTOP_COMMANDS.PICK_SCRIPT_FILE },
    pickDirectory: { command: DESKTOP_COMMANDS.PICK_DIRECTORY },
    copyText: {
      command: DESKTOP_COMMANDS.COPY_TEXT,
      buildArgs: ([text]) =>
        ({ text }) satisfies DesktopCommandArgs<'copy_text'>,
    },
    replaceSelectionWithCommand: {
      command: DESKTOP_COMMANDS.REPLACE_SELECTION_WITH_COMMAND,
      buildArgs: ([commandId]) =>
        ({
          commandId,
        }) satisfies DesktopCommandArgs<'replace_selection_with_command'>,
    },
  }
}
