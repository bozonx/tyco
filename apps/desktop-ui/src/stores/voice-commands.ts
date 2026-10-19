import { defineStore } from 'pinia'
import { computed, onScopeDispose } from 'vue'
import { translate } from '../lib/i18n'
import { createBuiltInVoiceCommands } from '../lib/voice-commands/built-in-voice-commands'
import { useDictationActions } from '../composables/use-dictation-actions'
import { createVoiceCommandModel } from '../lib/voice-commands/voice-command-model'
import { createCommandRunner } from '../lib/commands/command-runner'
import {
  isVoiceCommand,
  voiceInputIssue,
} from '../lib/voice-commands/voice-resolver'
import { commandLabel } from '../lib/commands/command-runtime'
import { useInvocationRunnerDependencies } from './invocations'
import { useDesktopStore } from './desktop'
import { useIpcStore } from './ipc'
import { useToolsStore } from './tools'
import { useHistoryStore } from './history'

export const useVoiceCommandsStore = defineStore('voiceCommands', () => {
  const ipc = useIpcStore()
  const desktop = useDesktopStore()
  const history = useHistoryStore()
  const tools = useToolsStore()
  const runner = createCommandRunner(useInvocationRunnerDependencies())
  const builtInCommands = computed(() =>
    createBuiltInVoiceCommands(tools, translate)
  )
  const model = createVoiceCommandModel({
    builtInCommands: () => builtInCommands.value,
    commands: () => desktop.userConfig.commands,
    tools,
    ...useDictationActions(),
    run: async (command, text, signal) => {
      await history.saveOutput(text).catch(() => undefined)
      if (signal.aborted) return { success: false, cancelled: true }
      const current = [
        ...builtInCommands.value,
        ...desktop.userConfig.commands,
      ].find((item) => item.id === command.id)
      if (
        !current ||
        !isVoiceCommand(current, tools) ||
        voiceInputIssue(current, text, tools)
      )
        return { success: false }
      const outcome = await runner.run(current, text, {
        source: 'voice',
        signal,
      })
      await ipc
        .call('log_command_run', {
          record: {
            commandId: command.id,
            name: commandLabel(command),
            source: 'voice',
            text,
            success: outcome.success,
            message: outcome.message,
          },
        })
        .catch(() => undefined)
      return outcome
    },
  })
  onScopeDispose(model.dispose)
  return model
})
