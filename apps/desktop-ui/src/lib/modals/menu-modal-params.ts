import type { ActionItem } from '@tyco/plugin-sdk'
import type { VoiceFinishIntent } from '../stt/voice-finish-intent'
import type { TranslationMeta } from '../translation/translation-meta'

export enum MenuModals {
  INSERT = 'insert',
  AI_TASK = 'ai-task',
  DIFF = 'diff',
  VOICE_RECOGNITION = 'voice-recognition',
  TRANSLATE = 'translate',
  PREVIEW = 'preview',
  ACTION_SELECT = 'action-select',
  NONE = 'none',
}

export interface InsertMenuParams {
  text?: string
  oldText?: string
  actions?: ActionItem[]
  allowInsertButton?: boolean
  shortcutsDisabled?: boolean
  toEditorVisible?: boolean
  /** Esc returns from a correction step to its original text. */
  correction?: boolean
  /** Shift+Space inserts the uncorrected text. */
  originalText?: string
  /** A pending correction will replace the displayed text. */
  correcting?: boolean
  /** A failed correction leaves the original text available. */
  correctionError?: string
  /** The correction returned the same text. */
  correctionUnchanged?: boolean
  /** Offer insertion, the editor and cancellation only. */
  insertOnly?: boolean
}
export interface AiTaskMenuParams {
  text?: string
  shortcutsDisabled?: boolean
  /** Runs this task immediately when the dialog opens. */
  taskId?: string
}
export interface TranslateMenuParams {
  text?: string
  shortcutsDisabled?: boolean
  /** Translates into this language immediately when the dialog opens. */
  language?: string
}
export type VoiceCorrectedHandler = (
  resultText: string,
  recognizedText: string,
  correctedText: string | undefined,
  intent: VoiceFinishIntent
) => void
export interface VoiceMenuParams {
  onCorrected?: VoiceCorrectedHandler | VoiceCorrectedHandler[]
  onCancel?: (() => void) | (() => void)[]
  /** Enter and Space submit to chat; Shift+Enter inserts, Tab opens actions. */
  quickSend?: boolean
  /** Enter and Space insert into the target window; Tab opens actions. */
  withNext?: boolean
  /** The bar keeps its host editor visible during dictation. */
  variant?: 'sheet' | 'bar'
  /** The host editor renders the voice input with these params. */
  inline?: boolean
  chat?: boolean
  /** Text before the caret when dictation started. */
  prefix?: string
  /** Text after the caret when dictation started. */
  suffix?: string
  /** Context attached to the dictated chat question. */
  context?: string
}
export interface DiffMenuParams {
  oldText: string
  newText: string
}
export interface PreviewMenuParams {
  text: string
  sourceText?: string
  translationMeta?: TranslationMeta
}
export interface ActionSelectMenuParams {
  onSelect: (actionId: string) => void
}
export interface PendingModalParams {
  ai?: boolean
  correction?: boolean
  label?: string
  onCancel?: () => void
}

export interface MenuModalParams {
  [MenuModals.INSERT]: InsertMenuParams
  [MenuModals.AI_TASK]: AiTaskMenuParams
  [MenuModals.DIFF]: DiffMenuParams
  [MenuModals.VOICE_RECOGNITION]: VoiceMenuParams
  [MenuModals.TRANSLATE]: TranslateMenuParams
  [MenuModals.PREVIEW]: PreviewMenuParams
  [MenuModals.ACTION_SELECT]: ActionSelectMenuParams
}
export type OpenMenuModal = keyof MenuModalParams
export type StepParams<K extends OpenMenuModal> = MenuModalParams[K] & {
  onLeave?: () => void
}
/** A screen and its cleanup callback, called once when the step leaves. */
export type MenuStep = {
  [K in OpenMenuModal]: { id: number; modal: K; params: StepParams<K> }
}[OpenMenuModal]
export type OpenModalArgs = {
  [K in OpenMenuModal]: Record<never, never> extends MenuModalParams[K]
    ? [modal: K, params?: StepParams<K>]
    : [modal: K, params: StepParams<K>]
}[OpenMenuModal]
export type UpdateModalArgs = {
  [K in OpenMenuModal]: [id: number, modal: K, params: Partial<StepParams<K>>]
}[OpenMenuModal]
