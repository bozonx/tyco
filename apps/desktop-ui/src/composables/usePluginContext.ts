import { ActionItem, useActionMenuStore } from '../stores/actionMenu'
import { useEditMenuStore } from '../stores/edditMenu'
import { useEditorInputStore } from '../stores/editorInput'
import { useIpcStore } from '../stores/ipc'
import { MenuModals, useMenuModalsStore } from '../stores/menuModals'
import { DEFAULT_PARAMS, useNavPanelStore } from '../stores/navPanel'
import { useRouteParams } from '../stores/routeParams'
import { PluginIndex } from '../types/plugins'
import useToast from './useToast'
import type { EditItem } from '../stores/edditMenu'

export default function usePluginContext() {
  const actionMenuStore = useActionMenuStore()
  const editMenuStore = useEditMenuStore()
  const editorInputStore = useEditorInputStore()
  const menuModalsStore = useMenuModalsStore()
  const navPanelStore = useNavPanelStore()
  const routeParamsStore = useRouteParams()
  const ipcStore = useIpcStore()
  const { toast } = useToast()

  class PluginContext {
    constructor(private pluginName: string) {}

    registerActionsItems(actions: ActionItem[]) {
      actionMenuStore.registerActionsItems(actions)
    }

    registerEditItems(edit: EditItem[]) {
      editMenuStore.registerEditItems(edit)
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

  function use(pluginIndex: PluginIndex) {
    const plugin = pluginIndex()
    const ctx = new PluginContext(plugin.name)

    plugin.init(ctx)
  }

  return {
    use,
  }
}
