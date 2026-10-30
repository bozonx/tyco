import type { ActionItem } from '@tyco/plugin-sdk'
import type {
  VoiceFinishBehavior,
  VoiceFinishIntent,
} from '../stt/voice-finish-intent'
import type { TranslationMeta } from '../translation/translation-meta'

export enum MenuModals {
  INSERT = 'insert',
  AI_TASK = 'ai-task',
  TRANSFORMATION = 'transformation',
  STYLING = 'styling',
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
  isEditorButtonVisible?: boolean
  /** Esc returns from a correction step to its original text. */
  correction?: boolean
  /** The text before correction. */
  originalText?: string
  /** The correction returned the same text. */
  isCorrectionUnchanged?: boolean
  /** Offer insertion, the editor and cancellation only. */
  insertOnly?: boolean
}
export interface AiTaskMenuParams {
  text?: string
  shortcutsDisabled?: boolean
  /** Runs this task immediately when the dialog opens. */
  taskId?: string
}
export interface TransformationMenuParams {
  text?: string
  shortcutsDisabled?: boolean
  /** Runs this transformation immediately when the dialog opens. */
  transformationId?: string
}
export interface StylingMenuParams {
  text?: string
  shortcutsDisabled?: boolean
  /** Runs this style immediately when the dialog opens. */
  stylingId?: string
}
export interface TranslateMenuParams {
  text?: string
  shortcutsDisabled?: boolean
  /** Translates into this language immediately when the dialog opens. */
  language?: string
}
type VoiceCorrectedHandler = (
  resultText: string,
  recognizedText: string,
  correctedText: string | undefined,
  intent: VoiceFinishIntent
) => void
export interface VoiceMenuParams {
  onCorrected?: VoiceCorrectedHandler | VoiceCorrectedHandler[]
  onCancel?: (() => void) | (() => void)[]
  /** Chooses the primary completion action and its shortcuts. */
  finishBehavior?: VoiceFinishBehavior
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
  /**
   * The activation mode that opened this voice input: its repeated hotkey or
   * external call confirms the input.
   */
  activationMode?: 'voice' | 'voiceChat'
}
export interface DiffMenuParams {
  oldText: string
  newText: string
  /** Explicit replacement after reviewing a conflicting editor transfer. */
  replaceEditor?: () => void
}
export interface PreviewMenuParams {
  text: string
  sourceText?: string
  translationMeta?: TranslationMeta
}
export interface ActionSelectMenuParams {
  onSelect: (actionId: string) => void
}
export type BufferedPendingAction = 'insert' | 'copy'

export interface PendingModalParams {
  ai?: boolean
  correction?: boolean
  transformation?: boolean
  styling?: boolean
  label?: string
  onCancel?: () => void
  allowBufferedIntent?: boolean
  allowBufferedCopy?: boolean
}

interface MenuModalParams {
  [MenuModals.INSERT]: InsertMenuParams
  [MenuModals.AI_TASK]: AiTaskMenuParams
  [MenuModals.TRANSFORMATION]: TransformationMenuParams
  [MenuModals.STYLING]: StylingMenuParams
  [MenuModals.DIFF]: DiffMenuParams
  [MenuModals.VOICE_RECOGNITION]: VoiceMenuParams
  [MenuModals.TRANSLATE]: TranslateMenuParams
  [MenuModals.PREVIEW]: PreviewMenuParams
  [MenuModals.ACTION_SELECT]: ActionSelectMenuParams
}
type OpenMenuModal = keyof MenuModalParams
type StepParams<K extends OpenMenuModal> = MenuModalParams[K] & {
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
