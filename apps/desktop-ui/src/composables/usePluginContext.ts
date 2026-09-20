import { type ActionItem, useActionMenuStore } from '../stores/actionMenu'
import { type EditItem, useEditMenuStore } from '../stores/editMenu'
import { useEditorInputStore } from '../stores/editorInput'
import { useIpcStore } from '../stores/ipc'
import { type MenuModals, useMenuModalsStore } from '../stores/menuModals'
import { type DEFAULT_PARAMS, useNavPanelStore } from '../stores/navPanel'
import { useRouteParams } from '../stores/routeParams'
import { useToolbarStore } from '../stores/toolbar'
import {
  type PluginContext as IPluginContext,
  type PluginIndex,
  type ToolbarItem,
} from '../types/plugins'
import useToast from './useToast'

export default function usePluginContext() {
  const actionMenuStore = useActionMenuStore()
  const editMenuStore = useEditMenuStore()
  const toolbarStore = useToolbarStore()
  const editorInputStore = useEditorInputStore()
  const menuModalsStore = useMenuModalsStore()
  const navPanelStore = useNavPanelStore()
  const routeParamsStore = useRouteParams()
  const ipcStore = useIpcStore()
  const { toast } = useToast()

  class PluginContext implements IPluginContext {
    constructor(private pluginName: string) {}

    registerActionsItems(actions: ActionItem[]) {
      actionMenuStore.registerActionsItems(actions)
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

    getEditorInputValue() {
      return editorInputStore.value
    }

    getEditorInputSelectedText() {
      return editorInputStore.selectedText
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
      timeout = 10000
    ) {
      toast(message, type, timeout)
    }

    callApiFunction(method: string, params: any) {
      return ipcStore.callFunction(method, params)
    }

    getUserConfig() {
      return ipcStore.params!.userConfig
    }

    getMyConfig() {
      return ipcStore.params!.userConfig.plugins[this.pluginName]
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
