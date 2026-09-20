import { ActionItem } from '../stores/actionMenu'
import { EditItem } from '../stores/edditMenu'
import { MenuModals } from '../stores/menuModals'
import { DEFAULT_PARAMS } from '../stores/navPanel'
import { InputConfigItem, IpcResult } from './index'
import type { UserConfig } from '@shared'

export type PluginIndex = () => {
  name: string
  label?: string
  labelKey?: string
  defaultConfig?: PluginConfig
  init: (ctx: PluginContext) => void
}

export interface PluginContext {
  registerActionsItems(actions: ActionItem[]): void
  registerEditItems(edit: EditItem[]): void
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
}

export interface PluginConfig {
  fields: InputConfigItem[]
}
