import { type ActionItem } from '../stores/actionMenu'
import { type EditItem } from '../stores/editMenu'
import { type MenuModals } from '../stores/menuModals'
import { type DEFAULT_PARAMS } from '../stores/navPanel'
import { type InputConfigItem, type IpcResult } from './index'
import type { UserConfig } from '@tyco/shared'

export type PluginIndex = () => {
  name: string
  label?: string
  labelKey?: string
  defaultConfig?: PluginConfig
  init: (ctx: PluginContext) => void
}

export interface ToolbarItem {
  id: string
  icon: string
  tooltip?: string
  tooltipKey?: string
  position?: 'left' | 'right'
  action: () => void | Promise<void>
}

export interface PluginContext {
  registerActionsItems(actions: ActionItem[]): void
  registerEditItems(edit: EditItem[]): void
  registerCaseItems(items: EditItem[]): void
  registerFormatItems(items: EditItem[]): void
  registerToolbarItems(items: ToolbarItem[]): void
  getEditorInputValue(): string
  getEditorInputSelectedText(): string
  setEditorInputValue(value: string): void
  replaceEditorInputSelection(value: string): void
  setEditorInputFocus(): void
  nextModal(modal: MenuModals, params: Record<string, any>): void
  backModal(): void
  closeAllModals(): void
  setPendingModal(params: Record<string, any>): void
  clearPendingModal(): void
  resetNavParams(params: Partial<typeof DEFAULT_PARAMS>): void
  updateNavParams(params: Partial<typeof DEFAULT_PARAMS>): void
  toEditor(text?: string): void
  toast(message: string, type: 'success' | 'error' | 'warn' | 'info'): void
  callApiFunction(functionName: string, args: any[]): Promise<IpcResult>
  getUserConfig(): UserConfig
  /** Returns the saved settings of the calling plugin, if any. */
  getMyConfig<T extends object>(): Partial<T> | undefined
}

export interface PluginConfig {
  fields: InputConfigItem[]
}
