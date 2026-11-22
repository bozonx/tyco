import {
  BUILTIN_TRANSLATE_COMMAND_ID,
  builtinTranslateCommand,
  type CommandConfig,
  type EditorHistoryOperation,
} from '@tyco/shared'
import { defineStore } from 'pinia'
import { onScopeDispose } from 'vue'
import { translate } from '../lib/i18n'
import { describeDictationError } from '../lib/stt/dictation-error'
import { useDictationActions } from '../composables/use-dictation-actions'
import { createVoiceCommandModel } from '../lib/voice-commands/voice-command-model'
import { createCommandRunner } from '../lib/commands/command-runner'
import { commandLabel } from '../lib/commands/command-runtime'
import {
  isVoiceCommand,
  voiceInputIssue,
} from '../lib/voice-commands/voice-resolver'
import { commandRunRecord } from '../lib/commands/command-run-record'
import {
  COMMAND_TIMED_OUT_CODE as TIMED_OUT_CODE,
  runWithinCommandLimit,
} from '../lib/commands/command-run-limit'
import type { InvocationOutcome } from '../lib/invocation/invocation-types'
import { resolveSink } from '../lib/invocation/result-sinks'
import { useInvocationRunnerDependencies } from './invocations'
import { useDesktopStore } from './desktop'
import { useIpcStore } from './ipc'
import { useOperationsStore } from './operations'
import { useHistoryStore } from './history'

function historyOperationOfCommand(
  command: CommandConfig
): EditorHistoryOperation | undefined {
  switch (command.operationId) {
    case 'core.translate':
      return 'translation'
    case 'core.correct':
      return 'correction'
    case 'core.aiTask':
    case 'core.transformation':
    case 'core.styling':
      return 'aiTask'
    default:
      return undefined
  }
}

export const useVoiceCommandsStore = defineStore('voiceCommands', () => {
  const ipc = useIpcStore()
  const desktop = useDesktopStore()
  const history = useHistoryStore()
  const tools = useOperationsStore()
  const runner = createCommandRunner(
    // the result replaces the voice window: the command has already run
    useInvocationRunnerDependencies({ isResultFinal: true })
  )

  const effectiveCommands = (): readonly CommandConfig[] => {
    const userCommands = desktop.userConfig?.commands ?? []
    if (desktop.userConfig?.translation?.isVoiceCommandEnabled !== false) {
      if (
        !userCommands.some((item) => item.id === BUILTIN_TRANSLATE_COMMAND_ID)
      ) {
        return [...userCommands, builtinTranslateCommand()]
      }
    }
    return userCommands
  }

  let transcriptHistoryId: string | null = null
  let transcriptHistoryText = ''

  const model = createVoiceCommandModel({
    commands: effectiveCommands,
    operations: tools,
    ...useDictationActions(),
    describeError: (cause) => describeDictationError(cause, translate),
    saveTranscript: async (text) => {
      transcriptHistoryText = text
      const id = await history.saveEditorHistory({
        text,
        kind: 'draft',
        origin: 'voice',
        instruction: { text: '', inputKind: 'voice' },
      })
      transcriptHistoryId = id
      return id
    },
    run: async (command, text, signal, context, parameters) => {
      if (signal.aborted) return { success: false, cancelled: true }
      const current = effectiveCommands().find((item) => item.id === command.id)
      if (
        !current ||
        !isVoiceCommand(current, tools) ||
        voiceInputIssue(current, text, tools, context, parameters)
      )
        return { success: false }
      const label = commandLabel(current)
      const instruction = { text: label, inputKind: 'voice' as const }
      const historyText = text.trim() || transcriptHistoryText || label
      const operation = historyOperationOfCommand(current)
      const sourceId = await history
        .saveEditorHistory({
          ...(transcriptHistoryId ? { id: transcriptHistoryId } : {}),
          text: historyText,
          kind: 'source',
          ...(operation ? { operation } : {}),
          origin: 'voice',
          instruction,
        })
        .catch(() => null)
      transcriptHistoryId = null
      if (signal.aborted) {
        await history
          .saveSourceFailure(sourceId, { kind: 'cancelled' })
          .catch(() => undefined)
        return { success: false, cancelled: true }
      }
      let producedOutput: string | undefined
      // the named parameters come as the input, as an agent gives them;
      // the run is bounded by the limit shared by all command runs
      const limited = await runWithinCommandLimit(
        desktop.userConfig?.commandRunTimeoutSec,
        signal,
        (runSignal) =>
          runner.run(current, text, {
            source: 'voice',
            signal: runSignal,
            onOutput: (output) => {
              producedOutput = output
            },
            ...(context ? { context } : {}),
            ...(Object.keys(parameters).length
              ? { input: { text, ...parameters } }
              : {}),
          })
      )
      const outcome: InvocationOutcome = limited.isTimedOut
        ? {
            success: false,
            code: TIMED_OUT_CODE,
            message: translate('commandRun.timedOut', {
              seconds: String(limited.seconds),
            }),
          }
        : limited.value
      const sink = resolveSink(current, {
        source: 'voice',
        output: tools.get(current.operationId)?.voiceOutputAction,
      })
      const outputText = (producedOutput ?? outcome.output)?.trim()
      if (outcome.success) {
        if (outputText) {
          await history
            .saveSourceResult(sourceId, outputText)
            .catch(() => undefined)
          if (sink === 'insertIntoWindow' || sink === 'copyToClipboard') {
            await history.saveOutput(outputText, 'voice').catch(() => undefined)
          }
        } else {
          await history.saveOutput(historyText, 'voice').catch(() => undefined)
        }
      } else if (outcome.cancelled || signal.aborted) {
        await history
          .saveSourceFailure(sourceId, { kind: 'cancelled' })
          .catch(() => undefined)
      } else {
        await history
          .saveSourceFailure(sourceId, {
            kind: limited.isTimedOut ? 'timeout' : 'error',
            ...(outcome.message && !limited.isTimedOut
              ? { message: outcome.message }
              : {}),
          })
          .catch(() => undefined)
      }
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
