import { DESKTOP_COMMANDS, type DesktopCommandArgs } from '@tyco/shared'
import type { WindowsFunctions } from './functions/windows'
import type { DomainCommandMap } from './command-types'

export function createWindowsCommandMap(): DomainCommandMap<
  keyof WindowsFunctions
> {
  return {
    hideWindow: {
      command: DESKTOP_COMMANDS.HIDE_WINDOW,
      buildArgs: (_, { activationId }) =>
        ({ activationId }) satisfies DesktopCommandArgs<'hide_window'>,
    },
    dismissQuickWindow: { command: DESKTOP_COMMANDS.DISMISS_QUICK_WINDOW },
    setQuickInputRegion: {
      command: DESKTOP_COMMANDS.SET_QUICK_INPUT_REGION,
      buildArgs: ([region]) =>
        ({ region }) satisfies DesktopCommandArgs<'set_quick_input_region'>,
    },
    openMainChat: {
      command: DESKTOP_COMMANDS.OPEN_MAIN_CHAT,
      buildArgs: ([attachment, question, autoSend]) =>
        ({
          attachment,
          question,
          autoSend,
        }) satisfies DesktopCommandArgs<'open_main_chat'>,
    },
    openMainEditor: {
      command: DESKTOP_COMMANDS.OPEN_MAIN_EDITOR,
      buildArgs: ([text, sourceText]) =>
        ({ text, sourceText }) satisfies DesktopCommandArgs<'open_main_editor'>,
    },
    activateMode: {
      command: DESKTOP_COMMANDS.ACTIVATE_MODE,
      buildArgs: ([mode, text]) =>
        ({ mode, text }) satisfies DesktopCommandArgs<'activate_mode'>,
    },
    pasteIntoTargetAndHide: {
      command: DESKTOP_COMMANDS.PASTE_INTO_TARGET_AND_HIDE,
      buildArgs: ([text], { activationId }) =>
        ({
          text,
          activationId,
        }) satisfies DesktopCommandArgs<'paste_into_target_and_hide'>,
      waitForKeysReleased: true,
    },
    openInBrowser: {
      command: DESKTOP_COMMANDS.OPEN_IN_BROWSER,
      buildArgs: ([url]) =>
        ({ url: String(url) }) satisfies DesktopCommandArgs<'open_in_browser'>,
    },
    openInBrowserAndHide: {
      command: DESKTOP_COMMANDS.OPEN_IN_BROWSER_AND_HIDE,
      buildArgs: ([url], { activationId }) =>
        ({
          url: String(url),
          activationId,
        }) satisfies DesktopCommandArgs<'open_in_browser_and_hide'>,
    },
  }
}
