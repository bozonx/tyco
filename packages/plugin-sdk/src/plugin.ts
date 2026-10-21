import type { InputConfigItem } from './config.js'
import type { ToolDefinition } from './tools.js'

export const PLUGIN_API_VERSION = 2
export type PluginCapability = 'editor' | 'browser' | 'notes'
export type PluginMessages = Record<string, string | Record<string, unknown>>
export interface PluginIcons {
  prefix: string
  icons: Record<string, { body: string; width?: number; height?: number }>
  width?: number
  height?: number
}
export interface PluginManifest {
  id: string
  version: string
  apiVersion: number
  capabilities: PluginCapability[]
  label?: string
  labelKey?: string
  description?: string
  descriptionKey?: string
  /** Saved text field that authorizes the notes root; defaults to pathToNotes. */
  notesDirectoryField?: string
  defaultLocale: string
  locales: Record<string, PluginMessages>
  icons?: PluginIcons
  defaultConfig?: PluginConfig
}
export interface Contribution {
  /** Lower values appear first within a UI placement. */
  order?: number
}
export type PluginDisposer = () => void | Promise<void>

export interface ActionItem extends Contribution {
  id?: string
  preferredKey?: string
  name?: string
  label?: string
  labelKey?: string
  icon?: string
  disabled?: boolean
  hint?: string
  useFullEditorText?: boolean
  preserveWhitespace?: boolean
  action: (text: string) => Promise<void>
}
export interface EditItem extends Contribution {
  id?: string
  name?: string
  labelKey?: string
  label?: string
  icon?: string
  selectionOnly?: boolean
  action: (text: string) => Promise<string> | string
}
export interface ToolbarItem extends Contribution {
  id: string
  icon?: string
  label?: string
  labelKey?: string
  tooltip?: string
  tooltipKey?: string
  position?: 'left' | 'right'
  selectionOnly?: boolean
  disabled?: boolean
  action: () => void | Promise<void>
}
/** Public registrations require stable IDs; host-built menu items may omit them. */
export type ActionContribution = ActionItem & { id: string }
export type EditContribution = EditItem & { id: string }
export type ToolbarContribution =
  | (ToolbarItem & { toolId?: never })
  | (Omit<ToolbarItem, 'action'> & { toolId: string; action?: never })

export interface PluginConfig {
  /** Version of persisted plugin settings, independent of the package version. */
  version?: number
  /** Ordered, declarative renames from version 0; never execute plugin code. */
  migrations?: Array<{ fromVersion: number; rename: Record<string, string> }>
  fields: InputConfigItem[]
  presets?: Record<string, Record<string, object>>
}
export interface PluginDesktopFunctions {
  openInBrowserAndHide: { args: [url: string]; result: void }
  saveNote: {
    args: [dir: string, fileName: string, text: string]
    result: string
  }
  appendNote: {
    args: [dir: string, fileName: string, text: string]
    result: string
  }
}
/** A serializable editor state used for conditional, atomic edits. */
export interface EditorInputSnapshot {
  value: string
  selectedText: string
  selectionStart: number
  selectionEnd: number
  revision: number
}
export interface PluginContext {
  readonly signal: AbortSignal
  onDispose(cleanup: () => void | Promise<void>): void
  registerActionsItems(items: ActionContribution[]): PluginDisposer
  registerEditItems(items: EditContribution[]): PluginDisposer
  registerCaseItems(items: EditContribution[]): PluginDisposer
  registerFormatItems(items: EditContribution[]): PluginDisposer
  registerToolbarItems(items: ToolbarContribution[]): PluginDisposer
  registerTools(items: ToolDefinition[]): PluginDisposer
  getEditorInputValue(): Promise<string>
  getEditorInputSelectedText(): Promise<string>
  getEditorInputSnapshot(): Promise<EditorInputSnapshot>
  /** Returns false if the document or selection changed after the snapshot. */
  applyEditorInputEdit(
    snapshot: EditorInputSnapshot,
    value: string,
    scope: 'selection' | 'document'
  ): Promise<boolean>
  setEditorInputValue(value: string): void
  replaceEditorInputSelection(value: string): void
  setEditorInputFocus(): void
  toEditor(text?: string): void
  t(key: string, params?: Record<string, string | number>): string
  toast(message: string, type: 'success' | 'error' | 'warn' | 'info'): void
  toastText(message: string, type: 'success' | 'error' | 'warn' | 'info'): void
  log(
    level: 'info' | 'warn' | 'error' | 'debug',
    message: string,
    error?: unknown
  ): void
  callApiFunction<K extends keyof PluginDesktopFunctions>(
    name: K,
    args: PluginDesktopFunctions[K]['args']
  ): Promise<{
    success: boolean
    result?: PluginDesktopFunctions[K]['result']
    error?: string
  }>
  getMyConfig<T extends object = Record<string, unknown>>(): Partial<T>
}
export interface PluginDefinition extends PluginManifest {
  init(
    ctx: PluginContext
  ):
    | void
    | (() => void | Promise<void>)
    | Promise<void | (() => void | Promise<void>)>
}
export type PluginFactory = () => PluginDefinition
/** A portable error understood by the host without importing plugin code. */
export class PluginError extends Error {
  readonly code = 'tyco-plugin-error'
  constructor(public readonly messageKey: string) {
    super(messageKey)
  }
}
export function isPluginError(error: unknown): error is PluginError {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    error.code === 'tyco-plugin-error' &&
    'messageKey' in error &&
    typeof error.messageKey === 'string'
  )
}

/** Cancellation is control flow, not a user-visible plugin failure. */
export class PluginCancellation extends Error {
  readonly code = 'tyco-plugin-cancelled'
}
export function isPluginCancellation(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    error.code === 'tyco-plugin-cancelled'
  )
}
