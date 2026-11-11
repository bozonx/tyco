import type { ActionItem } from '@tyco/plugin-sdk'
import type { ChatImage } from '@tyco/shared'
import type { DictationTarget } from '../stt/dictation-target'
import type {
  VoiceFinishBehavior,
  VoiceFinishIntent,
} from '../stt/voice-finish-intent'
import type { TranslationMeta } from '../translation/translation-meta'

export enum MenuModals {
  INSERT = 'insert',
  TRANSFORMATION = 'transformation',
  QUICK_AI_REQUEST = 'quick-ai-request',
  VOICE_COMMANDS = 'voice-commands',
  STYLING = 'styling',
  CHAT_PROMPTS = 'chat-prompts',
  FAVORITES = 'favorites',
  DIFF = 'diff',
  VOICE_RECOGNITION = 'voice-recognition',
  TRANSLATE = 'translate',
  PREVIEW = 'preview',
  ACTION_SELECT = 'action-select',
  NONE = 'none',
}

export interface InsertMenuParams {
  /** The message a dictated AI request replies to. */
  replyTo?: string
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
export interface TransformationMenuParams {
  text?: string
  shortcutsDisabled?: boolean
  /** Runs this transformation immediately when the dialog opens. */
  transformationId?: string
}
export interface QuickAiRequestMenuParams {
  screenshotMode?: boolean
  /** The screenshots of the activation, in the order they were taken */
  screenshots?: ChatImage[]
  text?: string
  shortcutsDisabled?: boolean
  inputMode?: 'text' | 'voice'
  profileId?: string | null
  /** The request the input starts with, e.g. from a prompt */
  prompt?: string
  /** Sends `prompt` at once instead of leaving it in the input */
  isPromptSent?: boolean
}
export interface VoiceCommandsMenuParams {
  /** Follows a late selection capture from this action-menu activation only. */
  selectionActivationId?: number
  text?: string
  shortcutsDisabled?: boolean
}
export interface StylingMenuParams {
  text?: string
  shortcutsDisabled?: boolean
  /** Runs this style immediately when the dialog opens. */
  stylingId?: string
}
export interface ChatPromptsMenuParams {
  text?: string
  shortcutsDisabled?: boolean
}
export interface FavoritesMenuParams {
  shortcutsDisabled?: boolean
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
  /** The destination of the dictated text: external app, chat, or editor. */
  target?: DictationTarget
  onCorrected?: VoiceCorrectedHandler | VoiceCorrectedHandler[]
  onCancel?: (() => void) | (() => void)[]
  /** Chooses the primary completion action and its shortcuts. */
  finishBehavior?: VoiceFinishBehavior
  /** The bar keeps its host editor visible during dictation. */
  variant?: 'sheet' | 'bar'
  /** The host editor renders the voice input with these params. */
  inline?: boolean
  chat?: boolean
  /**
   * Shows a labelled Cancel button with the Esc key instead of an icon cross in
   * compact chat mode.
   */
  cancelShortcut?: boolean
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
  activationMode?:
    | 'voice'
    | 'voiceChat'
    | 'voiceQuickAiRequest'
    | 'voiceScreenshotQuickAiRequest'
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
export interface BufferedSlotAction {
  slotIndex: number
  key: string
  label: string
  icon?: string
}
export type BufferedPendingAction =
  'insert' | 'copy' | 'editor' | BufferedSlotAction

export interface PendingModalParams {
  ai?: boolean
  correction?: boolean
  transformation?: boolean
  styling?: boolean
  label?: string
  cancelLabel?: string
  onCancel?: () => void
  allowBufferedIntent?: boolean
  allowBufferedCopy?: boolean
}

interface MenuModalParams {
  [MenuModals.INSERT]: InsertMenuParams
  [MenuModals.TRANSFORMATION]: TransformationMenuParams
  [MenuModals.QUICK_AI_REQUEST]: QuickAiRequestMenuParams
  [MenuModals.VOICE_COMMANDS]: VoiceCommandsMenuParams
  [MenuModals.STYLING]: StylingMenuParams
  [MenuModals.CHAT_PROMPTS]: ChatPromptsMenuParams
  [MenuModals.FAVORITES]: FavoritesMenuParams
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
