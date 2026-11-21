import type { CommandConfig, CommandOutputAction } from '@tyco/shared'

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
  function updateOutputAction(outputAction: CommandOutputAction) {
    update({ outputAction })
  }
  return {
    update,
    updateDescription,
    updateOperationConfig,
    updateOutputAction,
  }
}
