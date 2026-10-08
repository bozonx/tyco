import {
  type DesktopCallArgs,
  type DesktopFunctionArgs,
  PLUGIN_DESKTOP_FUNCTIONS,
  type PluginDesktopFunctionName,
} from '../lib/ipc/desktop-functions'
import { type ActionItem, useActionMenuStore } from '../stores/actionMenu'
import { type EditItem, useEditMenuStore } from '../stores/editMenu'
import { useEditorInputStore } from '../stores/editorInput'
import { useIpcStore } from '../stores/ipc'
import { type MenuModals, useMenuModalsStore } from '../stores/menuModals'
import { type DEFAULT_PARAMS, useNavPanelStore } from '../stores/navPanel'
import { useRouteParams } from '../stores/routeParams'
import { useToolbarStore } from '../stores/toolbar'
import { useToolsStore } from '../stores/tools'
import {
  type PluginContext as IPluginContext,
  type PluginIndex,
  type ToolbarItem,
  type ToolDefinition,
} from '../types/plugins'
import useToast from './useToast'

export default function usePluginContext() {
  const actionMenuStore = useActionMenuStore()
  const editMenuStore = useEditMenuStore()
  const toolbarStore = useToolbarStore()
  const toolsStore = useToolsStore()
  const editorInputStore = useEditorInputStore()
  const menuModalsStore = useMenuModalsStore()
  const navPanelStore = useNavPanelStore()
  const routeParamsStore = useRouteParams()
  const ipcStore = useIpcStore()
  const { toast } = useToast()

  class PluginContext implements IPluginContext {
    constructor(private pluginName: string) {}

    registerActionsItems(actions: ActionItem[]) {
      actionMenuStore.registerActionsItems(
        actions.map((action) => ({
          ...action,
          id: action.id ? `${this.pluginName}:${action.id}` : undefined,
        }))
      )
    }

    registerEditItems(edit: EditItem[]) {
      editMenuStore.registerEditItems(edit)
    }

    registerCaseItems(items: EditItem[]) {
      editMenuStore.registerCaseItems(items)
    }

    registerFormatItems(items: EditItem[]) {
      editMenuStore.registerFormatItems(items)
    }

    registerToolbarItems(items: ToolbarItem[]) {
      toolbarStore.registerToolbarItems(items)
    }

    registerTools(tools: ToolDefinition[]) {
      toolsStore.registerPluginTools(
        this.pluginName,
        tools,
        () => this.getMyConfig<Record<string, unknown>>() ?? {}
      )
    }

    getEditorInputValue() {
      return editorInputStore.value
    }

    getEditorInputSelectedText() {
      // a selection of whitespace only counts as none, see `actionText`
      return editorInputStore.hasSelection ? editorInputStore.selectedText : ''
    }

    setEditorInputValue(value: string) {
      editorInputStore.setValue(value)
    }

    replaceEditorInputSelection(value: string) {
      editorInputStore.replaceSelection(value)
    }

    setEditorInputFocus() {
      editorInputStore.focus()
    }

    nextModal(modal: MenuModals, params: Record<string, any>) {
      menuModalsStore.nextModal(modal, params)
    }

    backModal() {
      menuModalsStore.back()
    }

    closeAllModals() {
      menuModalsStore.closeAll()
    }

    setPendingModal(params: Record<string, any>) {
      menuModalsStore.setPendingModal(params)
    }

    clearPendingModal() {
      menuModalsStore.clearPendingModal()
    }

    resetNavParams(params: Partial<typeof DEFAULT_PARAMS>) {
      navPanelStore.resetNavParams(params)
    }

    updateNavParams(params: Partial<typeof DEFAULT_PARAMS>) {
      navPanelStore.upateNavParams(params)
    }

    toEditor(text: string) {
      routeParamsStore.toEditor(text)
    }

    toast(
      message: string,
      type: 'success' | 'error' | 'warn' | 'info' = 'info',
      timeout?: number
    ) {
      toast(message, type, timeout)
    }

    async callApiFunction<K extends PluginDesktopFunctionName>(
      method: K,
      params: DesktopFunctionArgs<K>
    ) {
      // plugins are plain JavaScript at run time, so the type is not enough
      if (!(PLUGIN_DESKTOP_FUNCTIONS as readonly string[]).includes(method)) {
        return {
          success: false,
          error: `Desktop function "${method}" is not available to plugins`,
        }
      }
      return ipcStore.callFunction(method, ...([params] as DesktopCallArgs<K>))
    }

    getUserConfig() {
      return ipcStore.params!.userConfig
    }

    getMyConfig<T extends object>() {
      return ipcStore.params!.userConfig.plugins?.[this.pluginName] as
        Partial<T> | undefined
    }
  }

  function createContext(pluginName: string): IPluginContext {
    return new PluginContext(pluginName)
  }

  function use(pluginIndex: PluginIndex) {
    const plugin = pluginIndex()
    const ctx = new PluginContext(plugin.name)

    plugin.init(ctx)
  }

  return { use, createContext }
}
