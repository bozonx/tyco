import { type ActionItem } from '../stores/actionMenu'
import { type EditItem } from '../stores/editMenu'
import { type MenuModals } from '../stores/menuModals'
import { type DEFAULT_PARAMS } from '../stores/navPanel'
import { type InputConfigItem, type IpcResult } from './index'
import type {
  DesktopFunctionArgs,
  DesktopFunctionResult,
  PluginDesktopFunctionName,
} from '../lib/ipc/desktop-functions'
import type { ToolDefinition } from '../lib/tools/tool-types'
import type { UserConfig } from '@tyco/shared'

export { NO_INPUT_SCHEMA, TEXT_INPUT_SCHEMA } from '../lib/tools/tool-types'
export type {
  DefaultCommand,
  DefaultCommandsContext,
  JsonSchema,
  ParseResult,
  ToolCall,
  ToolDefinition,
  ToolParseContext,
  ToolResult,
} from '../lib/tools/tool-types'

export type PluginIndex = () => {
  name: string
  label?: string
  labelKey?: string
  description?: string
  descriptionKey?: string
  defaultConfig?: PluginConfig
  init: (ctx: PluginContext) => void
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

export interface PluginContext {
  /**
   * Stable local IDs are scoped to this plugin; preferredKey is used only for
   * initial placement.
   */
  registerActionsItems(actions: ActionItem[]): void
  registerEditItems(edit: EditItem[]): void
  registerCaseItems(items: EditItem[]): void
  registerFormatItems(items: EditItem[]): void
  registerToolbarItems(items: ToolbarItem[]): void
  /**
   * Tools commands can run, under `<pluginName>.<id>`; a command falls back to
   * the plugin settings for the fields it leaves empty
   */
  registerTools(tools: ToolDefinition[]): void
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
  /** Only the functions in `PLUGIN_DESKTOP_FUNCTIONS` are available */
  callApiFunction<K extends PluginDesktopFunctionName>(
    functionName: K,
    args: DesktopFunctionArgs<K>
  ): Promise<IpcResult<DesktopFunctionResult<K>>>
  getUserConfig(): UserConfig
  /** Returns the saved settings of the calling plugin, if any. */
  getMyConfig<T extends object>(): Partial<T> | undefined
}

export interface PluginConfig {
  fields: InputConfigItem[]
}
