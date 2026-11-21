import type { CommandConfig, CommandOutputAction } from '@tyco/shared'

export function countAdvancedCustomizations(
  command: CommandConfig,
  context?: {
    defaultOutputAction?: CommandOutputAction
    canSelectPlatforms?: boolean
    canLogOutput?: boolean
    canPreTransform?: boolean
    canParseArguments?: boolean
  }
): number {
  let count = 0
  const defaultOutputAction = context?.defaultOutputAction ?? 'none'
  if (command.outputAction !== defaultOutputAction) count++
  if (context?.canSelectPlatforms && (command.platforms?.length ?? 0) > 0) count++
  if (context?.canLogOutput && command.isOutputLogged) count++
  if (command.isAvailableExternally) count++
  if (command.isVoiceEnabled || (command.phrases?.some((p) => p.trim()) ?? false)) count++
  if (context?.canParseArguments && command.isLlmArgumentParsingEnabled) count++
  if (
    context?.canPreTransform !== false &&
    (command.isLlmPreTransformEnabled ||
      command.llmPreTransformPrompt?.trim())
  ) {
    count++
  }
  if (command.description?.trim()) count++
  return count
}

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
