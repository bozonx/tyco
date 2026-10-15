import { createSettingsCommandMap } from './settings-command-map'
import { createWindowsCommandMap } from './windows-command-map'
import { createHistoryCommandMap } from './history-command-map'
import { createPluginsCommandMap } from './plugins-command-map'
import { createActionsCommandMap } from './actions-command-map'
import { createHotkeysCommandMap } from './hotkeys-command-map'
import { createDiagnosticsCommandMap } from './diagnostics-command-map'
import { createStorageCommandMap } from './storage-command-map'
import { createExternalCommandMap } from './external-command-map'
import { createAiProfilesCommandMap } from './ai-profiles-command-map'
import type { DomainCommandMap } from './command-types'
import type { DesktopFunctionName } from './desktop-functions'
export type { CommandEntry } from './command-types'

export function createCommandMap(): DomainCommandMap<DesktopFunctionName> {
  return {
    ...createSettingsCommandMap(),
    ...createWindowsCommandMap(),
    ...createHistoryCommandMap(),
    ...createPluginsCommandMap(),
    ...createActionsCommandMap(),
    ...createHotkeysCommandMap(),
    ...createDiagnosticsCommandMap(),
    ...createStorageCommandMap(),
    ...createExternalCommandMap(),
    ...createAiProfilesCommandMap(),
  }
}
