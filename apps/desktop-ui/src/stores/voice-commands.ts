import { defineStore } from 'pinia'
import { onScopeDispose } from 'vue'
import { useDictationActions } from '../composables/use-dictation-actions'
import { createVoiceCommandModel } from '../lib/voice-commands/voice-command-model'
import { createCommandRunner } from '../lib/commands/command-runner'
import {
  isVoiceCommand,
  voiceInputIssue,
} from '../lib/voice-commands/voice-resolver'
import { commandLabel } from '../lib/commands/command-runtime'
import { useInvocationRunnerDependencies } from './invocations'
import { useIpcStore } from './ipc'
import { useToolsStore } from './tools'
import { useHistoryStore } from './history'

export const useVoiceCommandsStore = defineStore('voiceCommands', () => {
  const ipc = useIpcStore()
  const history = useHistoryStore()
  const tools = useToolsStore()
  const runner = createCommandRunner(useInvocationRunnerDependencies())
  const model = createVoiceCommandModel({
    commands: () => ipc.desktopState.userConfig.commands,
    tools,
    ...useDictationActions(),
    run: async (command, text, signal) => {
      await history.saveOutput(text).catch(() => undefined)
      if (signal.aborted) return { success: false, cancelled: true }
      const current = ipc.desktopState.userConfig.commands.find(
        (item) => item.id === command.id
      )
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
        .callFunction('logCommandRun', [
          {
            commandId: command.id,
            name: commandLabel(command),
            source: 'voice',
            text,
            success: outcome.success,
            message: outcome.message,
          },
        ])
        .catch(() => undefined)
      return outcome
    },
  })
  onScopeDispose(model.dispose)
  return model
})
