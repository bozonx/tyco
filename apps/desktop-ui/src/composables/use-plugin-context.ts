import { createInvocationRunner } from '../lib/invocation/invocation-runner'
import { createToolInvoker } from '../lib/invocation/invoke-tool'
import { translate } from '../lib/i18n/index'
import { clientLogger } from '../lib/logger/index'
import { createPluginContext } from '../lib/plugins/plugin-context'
import type { PluginLifecycle } from '../lib/plugins/plugin-manager'
import { useActionMenuStore } from '../stores/action-menu'
import { useEditMenuStore } from '../stores/edit-menu'
import { useEditorInputStore } from '../stores/editor-input'
import { useHistoryStore } from '../stores/history'
import { useInvocationRunnerDependencies } from '../stores/invocations'
import { useIpcStore } from '../stores/ipc'
import { useEditorNavigation } from '../composables/use-editor-navigation'
import { useToolbarStore } from '../stores/toolbar'
import { useToolsStore } from '../stores/tools'
import useToast from './use-toast'

export default function usePluginContext() {
  const actions = useActionMenuStore()
  const edits = useEditMenuStore()
  const toolbar = useToolbarStore()
  const tools = useToolsStore()
  const invokeTool = createToolInvoker({ tools })
  const invocationRunner = createInvocationRunner(
    useInvocationRunnerDependencies()
  )
  const history = useHistoryStore()
  const editor = useEditorInputStore()
  const ipc = useIpcStore()
  const routes = useEditorNavigation()
  const { toastKey, toastText } = useToast()

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
      invokeTool: (toolId, snapshot, signal) =>
        invokeTool(
          { toolId, toolConfig: {}, label: toolId, outputAction: 'none' },
          snapshot.selectedText.trim() ? snapshot.selectedText : snapshot.value,
          {
            source: 'toolbar',
            output: 'none',
            signal,
            editorSnapshot: snapshot,
          }
        ),
      invokeActionTool: async (toolId, text, signal) => {
        if (text.trim()) await history.saveOutput(text)
        await invocationRunner.run(
          { toolId, toolConfig: {}, label: toolId },
          text,
          { source: 'menu', signal }
        )
      },
      getEditorInputValue: () => editor.value,
      getEditorInputSelectedText: () =>
        editor.hasSelection ? editor.selectedText : '',
      getEditorInputSnapshot: editor.getSnapshot,
      applyEditorInputEdit: editor.applySnapshotEdit,
      setEditorInputValue: (value) => editor.replaceValue(value),
      replaceEditorInputSelection: (value) => editor.replaceSelection(value),
      setEditorInputFocus: () => editor.requestFocus(),
      toEditor: (text) => routes.toEditor(text),
      t: translate,
      toastKey,
      toastText,
      log: (level, message, error) =>
        error === undefined
          ? clientLogger.log(level, message, id)
          : clientLogger.error(message, error, id),
      writeNote: (pluginId, dir, fileName, text, append) =>
        ipc.call('write_plugin_note', {
          pluginId,
          dir,
          fileName,
          text,
          append,
        }),
      openInBrowserAndHide: (url) =>
        ipc.call('open_in_browser_and_hide', { url }),
    })
  }
  return { createContext }
}
