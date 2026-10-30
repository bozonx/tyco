import type { VoiceFinishBehavior } from './voice-finish-intent'

export type DictationTarget = 'external' | 'chat' | 'editor'

export function resolveDictationTarget(options: {
  target?: DictationTarget
  finishBehavior?: VoiceFinishBehavior
  chat?: boolean
  inline?: boolean
}): DictationTarget {
  if (options.target) return options.target
  if (options.finishBehavior === 'insertIntoTarget') return 'external'
  if (options.chat || options.finishBehavior === 'submitToChat') return 'chat'
  if (options.inline) return 'editor'
  return 'external'
}
