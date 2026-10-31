import type { CommandConfig, CommandOutputAction } from '@tyco/shared'

import { externalTimeoutOf } from './command-config'

export function createCommandEditorModel(deps: {
  getCommand: () => CommandConfig
  update: (command: CommandConfig) => void
}) {
  function update(patch: Partial<CommandConfig>) {
    deps.update({ ...deps.getCommand(), ...patch })
  }
  function updateDescription(value: string) {
    const { description: _previous, ...rest } = deps.getCommand()
    deps.update(value.trim() ? { ...rest, description: value } : rest)
  }
  function updateToolConfig(field: string, value: unknown) {
    const { [field]: _previous, ...rest } = deps.getCommand().toolConfig
    update({
      toolConfig: value === undefined ? rest : { ...rest, [field]: value },
    })
  }
  /** An empty or invalid text gives the default limit */
  function updateExternalTimeout(value: string) {
    // the text must be a number as a whole: `10abc` is no limit
    const seconds = /^\s*\d+(\.\d+)?\s*$/.test(value) ? Number(value) : NaN
    update({ externalTimeoutSec: externalTimeoutOf(seconds) })
  }
  function updateOutputAction(outputAction: CommandOutputAction) {
    update({ outputAction })
  }
  return {
    update,
    updateDescription,
    updateToolConfig,
    updateExternalTimeout,
    updateOutputAction,
  }
}
