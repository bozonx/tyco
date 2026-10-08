import type { DesktopCallArgs } from '../lib/ipc/desktop-functions'
import { translate } from '../lib/i18n'
import { clientLogger } from '../lib/logger'
import { createPluginContext } from '../lib/plugins/plugin-context'
import type { PluginLifecycle } from '../lib/plugins/plugin-manager'
import { useActionMenuStore } from '../stores/actionMenu'
import { useEditMenuStore } from '../stores/editMenu'
import { useEditorInputStore } from '../stores/editorInput'
import { useIpcStore } from '../stores/ipc'
import { useRouteParams } from '../stores/routeParams'
import { useToolbarStore } from '../stores/toolbar'
import { useToolsStore } from '../stores/tools'
import useToast from './useToast'

export default function usePluginContext() {
  const actions = useActionMenuStore()
  const edits = useEditMenuStore()
  const toolbar = useToolbarStore()
  const tools = useToolsStore()
  const editor = useEditorInputStore()
  const ipc = useIpcStore()
  const routes = useRouteParams()
  const { toast, toastText } = useToast()

  function createContext(
    id: string,
    config: () => Record<string, unknown>,
    lifecycle: PluginLifecycle
  ) {
    return createPluginContext(id, config, lifecycle, {
      registerActionsItems: (items) => actions.registerActionsItems(items),
      registerEditItems: (items) => edits.registerEditItems(items),
      registerCaseItems: (items) => edits.registerCaseItems(items),
      registerFormatItems: (items) => edits.registerFormatItems(items),
      registerToolbarItems: (items) => toolbar.registerToolbarItems(items),
      registerTools: (items, baseConfig) =>
        tools.registerPluginTools(id, items, baseConfig),
      getEditorInputValue: () => editor.value,
      getEditorInputSelectedText: () =>
        editor.hasSelection ? editor.selectedText : '',
      setEditorInputValue: (value) => editor.setValue(value),
      replaceEditorInputSelection: (value) => editor.replaceSelection(value),
      setEditorInputFocus: () => editor.focus(),
      toEditor: (text) => routes.toEditor(text),
      t: translate,
      toast,
      toastText,
      log: (level, message, error) =>
        error === undefined
          ? clientLogger.log(level, message, id)
          : clientLogger.error(message, error, id),
      callApiFunction: (name, args) =>
        ipc.callFunction(name, ...([args] as DesktopCallArgs<typeof name>)),
    })
  }
  return { createContext }
}
