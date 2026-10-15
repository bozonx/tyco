import { isBuiltInVoiceCommand } from './built-in-voice-commands'
import { commandUnavailableReason } from '../commands/command-runtime'
import { computed, ref, shallowRef } from 'vue'
import type { CommandConfig } from '@tyco/shared'
import type { InvocationOutcome } from '../invocation/invocation-types'
import type { DictationHandlers } from '../stt/dictation-controller'
import { liveTranscriptText } from '../stt/live-transcript'
import type { ToolLookup } from '../tools/tool-types'
import {
  compileVoiceRoutes,
  isVoiceCommand,
  resolveVoice,
  voiceInputIssue,
  type VoiceCandidate,
} from './voice-resolver'

export interface VoiceCommandDependencies {
  commands: () => readonly CommandConfig[]
  builtInCommands?: () => readonly CommandConfig[]
  tools: ToolLookup
  startDictation: (handlers: DictationHandlers) => Promise<void>
  finishDictation: () => Promise<string>
  cancelDictation: () => Promise<void>
  run: (
    command: CommandConfig,
    text: string,
    signal: AbortSignal
  ) => Promise<InvocationOutcome>
}

/** One activation owns recognition and execution; partial text can never run. */
export function createVoiceCommandModel(deps: VoiceCommandDependencies) {
  const stage = ref<'idle' | 'recording' | 'finishing' | 'review' | 'running'>(
    'idle'
  )
  const transcript = ref('')
  const inputText = ref('')
  const selected = shallowRef<VoiceCandidate>()
  const error = ref('')
  let generation = 0
  let disposed = false
  let starting: Promise<void> | undefined
  let stopping = Promise.resolve()
  let controller: AbortController | undefined
  const commands = computed(() => [
    ...(deps.builtInCommands?.() ?? []),
    ...deps.commands().filter((item) => !isBuiltInVoiceCommand(item)),
  ])
  const findCommand = (id: string | undefined) =>
    commands.value.find((item) => item.id === id)
  const routes = computed(() => compileVoiceRoutes(commands.value, deps.tools))
  const resolution = computed(() =>
    resolveVoice(routes.value, transcript.value)
  )
  const catalogRoutes = computed(() =>
    compileVoiceRoutes(commands.value, deps.tools, true)
  )
  const catalog = computed(() =>
    commands.value.filter((command) =>
      catalogRoutes.value.some((route) => route.commandId === command.id)
    )
  )
  const command = computed(() => findCommand(selected.value?.commandId))
  const inputIssue = computed(() =>
    command.value
      ? voiceInputIssue(command.value, inputText.value, deps.tools)
      : undefined
  )
  const canRun = computed(
    () =>
      stage.value === 'review' &&
      command.value &&
      isVoiceCommand(command.value, deps.tools) &&
      !inputIssue.value
  )

  const choose = (candidate: VoiceCandidate) => {
    if (stage.value !== 'review') return
    selected.value = candidate
    inputText.value = candidate.text
    error.value = ''
  }
  const chooseCommand = (commandId: string) =>
    choose({
      commandId,
      text: transcript.value,
      parameters: {},
      consumedWordCount: 0,
      textOffset: 0,
    })

  const run = async () => {
    const target = findCommand(selected.value?.commandId)
    if (
      stage.value !== 'review' ||
      !target ||
      !isVoiceCommand(target, deps.tools) ||
      voiceInputIssue(target, inputText.value, deps.tools)
    )
      return
    const current = generation
    const text = inputText.value
    controller = new AbortController()
    error.value = ''
    stage.value = 'running'
    try {
      const result = await deps.run(target, text, controller.signal)
      if (current !== generation || disposed) return
      if (!result.success)
        error.value = result.message || 'voiceCommands.failed'
      // Keep the transcript and input, including after a successful run.
    } catch (cause) {
      if (current !== generation || disposed) return
      error.value = cause instanceof Error ? cause.message : String(cause)
    } finally {
      if (current === generation && !disposed) {
        controller = undefined
        stage.value = 'review'
      }
    }
  }

  const finish = async () => {
    if (stage.value !== 'recording') return
    stage.value = 'finishing'
    const current = generation
    try {
      await starting
      if (current !== generation || disposed || stage.value !== 'finishing')
        return
      const finalText = await deps.finishDictation()
      if (current !== generation || disposed) return
      if (!finalText.trim()) {
        error.value = 'voiceCommands.none'
        stage.value = 'review'
        return
      }
      transcript.value = finalText
      stage.value = 'review'
      const result = resolveVoice(
        compileVoiceRoutes(commands.value, deps.tools),
        finalText
      )
      if (result.kind === 'match') {
        choose(result.candidates[0]!)
        if (command.value?.voiceConfirmation === 'auto' && canRun.value)
          await run()
      }
    } catch (cause) {
      if (current !== generation || disposed) return
      error.value = cause instanceof Error ? cause.message : String(cause)
      stage.value = 'review'
    }
  }

  const start = async () => {
    if (
      disposed ||
      stage.value === 'recording' ||
      stage.value === 'finishing' ||
      stage.value === 'running'
    )
      return
    const current = ++generation
    stage.value = 'recording'
    error.value = ''
    // Preserve the previous text until new recognition explicitly replaces it.
    selected.value = undefined
    const pending = (async () => {
      await stopping
      if (current !== generation || disposed) return
      await deps.startDictation({
        onText: (state) => {
          if (
            current === generation &&
            !disposed &&
            stage.value === 'recording'
          )
            transcript.value = liveTranscriptText(state)
        },
        onError: (cause) => {
          if (current !== generation || disposed) return
          generation += 1
          error.value = cause.message
          stage.value = 'review'
          stopping = stopping
            .then(() => deps.cancelDictation())
            .catch(() => undefined)
        },
      })
    })()
      .catch((cause: unknown) => {
        if (current !== generation || disposed) return
        error.value = cause instanceof Error ? cause.message : String(cause)
        stage.value = 'review'
      })
      .finally(() => {
        if (starting === pending) starting = undefined
      })
    starting = pending
    await pending
  }

  const cancel = () => {
    generation += 1
    controller?.abort()
    stage.value = 'idle'
    const pending = starting
    stopping = stopping
      .then(async () => {
        await deps.cancelDictation()
        await pending
        await deps.cancelDictation()
      })
      .catch(() => undefined)
    return stopping
  }
  return {
    stage,
    transcript,
    inputText,
    selected,
    error,
    routes,
    catalogRoutes,
    unavailableReason: (command: CommandConfig) =>
      commandUnavailableReason(command, deps.tools),
    resolution,
    catalog,
    builtInCatalog: computed(() => catalog.value.filter(isBuiltInVoiceCommand)),
    customCatalog: computed(() =>
      catalog.value.filter((item) => !isBuiltInVoiceCommand(item))
    ),
    command,
    inputIssue,
    canRun,
    choose,
    chooseCommand,
    run,
    start,
    finish,
    editTranscript(value: string) {
      if (stage.value !== 'review') return
      transcript.value = value
      selected.value = undefined
      error.value = ''
    },
    cancel,
    dispose() {
      disposed = true
      void cancel().catch(() => undefined)
    },
  }
}
