import type { InputConfigItem } from './config.js'
import type { ToolDefinition } from './tools.js'

export const PLUGIN_API_VERSION = 1
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
  legacyIds?: string[]
  label?: string
  labelKey?: string
  description?: string
  descriptionKey?: string
}
export interface ActionItem {
  id?: string
  preferredKey?: string
  name?: string
  labelKey?: string
  icon?: string
  disabled?: boolean
  hint?: string
  useFullEditorText?: boolean
  preserveWhitespace?: boolean
  action: (text: string) => Promise<void>
}
export interface EditItem {
  id?: string
  name?: string
  labelKey?: string
  label?: string
  icon?: string
  selectionOnly?: boolean
  action: (text: string) => Promise<string> | string
}
export interface ToolbarItem {
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
export interface PluginConfig {
  fields: InputConfigItem[]
}
export interface PluginDesktopFunctions {
  openInBrowserAndClose: { args: [url: string]; result: void }
  saveNote: {
    args: [dir: string, fileName: string, text: string]
    result: string
  }
  appendNote: {
    args: [dir: string, fileName: string, text: string]
    result: string
  }
}
export interface PluginContext {
  readonly signal: AbortSignal
  onDispose(cleanup: () => void | Promise<void>): void
  registerActionsItems(items: ActionItem[]): void
  registerEditItems(items: EditItem[]): void
  registerCaseItems(items: EditItem[]): void
  registerFormatItems(items: EditItem[]): void
  registerToolbarItems(items: ToolbarItem[]): void
  registerTools(tools: ToolDefinition[]): void
  getEditorInputValue(): string
  getEditorInputSelectedText(): string
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
  defaultLocale: string
  locales: Record<string, PluginMessages>
  icons?: PluginIcons
  defaultConfig?: PluginConfig
  configVersion?: number
  migrateConfig?(
    config: Record<string, unknown>,
    fromVersion: number
  ): Record<string, unknown>
  normalizeConfig?(config: Record<string, unknown>): Record<string, unknown>
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
