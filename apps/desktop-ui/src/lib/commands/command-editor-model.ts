import type { CommandConfig, CommandOutputAction } from '@tyco/shared'

import { externalTimeoutOf } from './command-config'

export function createCommandEditorModel(deps: {
  getCommand: () => CommandConfig
  update: (command: CommandConfig) => void
}) {
  function update(patch: Partial<CommandConfig>) {
    deps.update({ ...deps.getCommand(), ...patch })
  }
  /** A blank description is none; the field stays, as the schema requires */
  function updateDescription(value: string) {
    update({ description: value.trim() ? value : '' })
  }
  function updateOperationConfig(field: string, value: unknown) {
    const { [field]: _previous, ...rest } = deps.getCommand().operationConfig
    update({
      operationConfig: value === undefined ? rest : { ...rest, [field]: value },
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
    updateOperationConfig,
    updateExternalTimeout,
    updateOutputAction,
  }
}
