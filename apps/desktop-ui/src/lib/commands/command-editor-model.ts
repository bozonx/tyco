import {
  type CommandConfig,
  type CustomActionAfterRun,
  SCRIPT_MAX_TIMEOUT_SEC,
} from '@tyco/shared'

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
  function updateTimeout(value: string) {
    const seconds = Number.parseInt(value, 10)
    updateToolConfig(
      'timeoutSec',
      Number.isFinite(seconds) && seconds > 0
        ? Math.min(seconds, SCRIPT_MAX_TIMEOUT_SEC)
        : undefined
    )
  }
  function updateLauncherAfterRun(action: CustomActionAfterRun) {
    update({ launcherAfterRun: { action } })
  }
  return {
    update,
    updateDescription,
    updateToolConfig,
    updateTimeout,
    updateLauncherAfterRun,
  }
}
