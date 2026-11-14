import { defineStore } from 'pinia'
import { onScopeDispose } from 'vue'
import { translate } from '../lib/i18n'
import { describeDictationError } from '../lib/stt/dictation-error'
import { useDictationActions } from '../composables/use-dictation-actions'
import { createVoiceCommandModel } from '../lib/voice-commands/voice-command-model'
import { createCommandRunner } from '../lib/commands/command-runner'
import {
  isVoiceCommand,
  voiceInputIssue,
} from '../lib/voice-commands/voice-resolver'
import { commandRunRecord } from '../lib/commands/command-run-record'
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
  const model = createVoiceCommandModel({
    commands: () => desktop.userConfig.commands,
    tools,
    ...useDictationActions(),
    describeError: (cause) => describeDictationError(cause, translate),
    saveTranscript: (text) =>
      history.saveSource(text, 'voiceCorrection', 'voice'),
    run: async (command, text, signal, context, parameters) => {
      if (signal.aborted) return { success: false, cancelled: true }
      const current = desktop.userConfig.commands.find(
        (item) => item.id === command.id
      )
      if (
        !current ||
        !isVoiceCommand(current, tools) ||
        voiceInputIssue(current, text, tools, context, parameters)
      )
        return { success: false }
      await history.saveOutput(text).catch(() => undefined)
      if (signal.aborted) return { success: false, cancelled: true }
      // the named parameters come as the input, as an agent gives them
      const outcome = await runner.run(current, text, {
        source: 'voice',
        signal,
        ...(context ? { context } : {}),
        ...(Object.keys(parameters).length
          ? { input: { text, ...parameters } }
          : {}),
      })
      await ipc
        .call('log_command_run', {
          record: commandRunRecord(current, 'voice', text, outcome),
        })
        .catch(() => undefined)
      return outcome
    },
  })
  onScopeDispose(model.dispose)
  return model
})
