import { DESKTOP_COMMANDS, type DesktopCommandArgs } from '@tyco/shared'
import type { HotkeysFunctions } from './functions/hotkeys'
import type { DomainCommandMap } from './command-types'

export function createHotkeysCommandMap(): DomainCommandMap<
  keyof HotkeysFunctions
> {
  return {
    applyHotkey: {
      command: DESKTOP_COMMANDS.APPLY_HOTKEY,
      buildArgs: ([request]) =>
        ({ request }) satisfies DesktopCommandArgs<'apply_hotkey'>,
    },
    configureHotkeys: { command: DESKTOP_COMMANDS.CONFIGURE_HOTKEYS },
    rebindHotkeys: { command: DESKTOP_COMMANDS.REBIND_HOTKEYS },
    suspendHotkeys: {
      command: DESKTOP_COMMANDS.SUSPEND_HOTKEYS,
      buildArgs: ([suspended]) =>
        ({ suspended }) satisfies DesktopCommandArgs<'suspend_hotkeys'>,
    },
    getHotkeyProviderInfo: {
      command: DESKTOP_COMMANDS.GET_HOTKEY_PROVIDER_INFO,
    },
  }
}
