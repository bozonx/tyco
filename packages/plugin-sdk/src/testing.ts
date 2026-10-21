import { vi, type Mock } from 'vitest'
import { runToolFromToolbar } from './toolbar-tool.js'

import type {
  ToolbarContribution,
  EditorInputSnapshot,
  PluginContext,
  ToolbarItem,
  ToolDefinition,
} from './index.js'

export interface PluginTestContextOptions {
  value?: string
  selectedText?: string
  config?: Record<string, unknown>
  apiResult?: { success: boolean; error?: string }
}

type PluginTestMocks = {
  [Key in keyof PluginContext]: PluginContext[Key] extends (
    ...args: infer Args
  ) => infer Result
    ? Mock<(...args: Args) => Result>
    : PluginContext[Key]
}

/** Builds a mutable editor context for plugin behavior and conflict tests. */
export function createPluginTestContext(
  options: PluginTestContextOptions = {}
): {
  ctx: PluginContext
  mocks: PluginTestMocks
  toolbarItems: ToolbarItem[]
  tools: ToolDefinition[]
} {
  const toolbarItems: ToolbarItem[] = []
  const tools: ToolDefinition[] = []
  let value = options.value ?? options.selectedText ?? ''
  let selectedText = options.selectedText ?? ''
  let revision = 0

  const ctx = {
    signal: new AbortController().signal,
    onDispose: vi.fn(),
    t: vi.fn((key: string) => key),
    log: vi.fn(),
    toastText: vi.fn(),
    registerActionsItems: vi.fn<PluginContext['registerActionsItems']>(
      () => () => {}
    ),
    registerEditItems: vi.fn<PluginContext['registerEditItems']>(
      () => () => {}
    ),
    registerCaseItems: vi.fn<PluginContext['registerCaseItems']>(
      () => () => {}
    ),
    registerFormatItems: vi.fn<PluginContext['registerFormatItems']>(
      () => () => {}
    ),
    registerToolbarItems: vi.fn((items: ToolbarContribution[]) => {
      const registered = items.map((item): ToolbarItem => ({
        ...item,
        action:
          item.toolId !== undefined
            ? async () => {
                const tool = tools.find((tool) => tool.id === item.toolId)
                if (!tool) throw new Error('Unknown toolbar tool')
                await runToolFromToolbar(ctx, tool)
              }
            : item.action!,
      }))
      toolbarItems.push(...registered)
      return () => {
        for (const item of registered) {
          const index = toolbarItems.indexOf(item)
          if (index >= 0) toolbarItems.splice(index, 1)
        }
      }
    }),
    registerTools: vi.fn((items: ToolDefinition[]) => {
      tools.push(...items)
      return () => {
        for (const item of items) {
          const index = tools.indexOf(item)
          if (index >= 0) tools.splice(index, 1)
        }
      }
    }),
    getEditorInputValue: vi.fn(async () => value),
    getEditorInputSelectedText: vi.fn(async () => selectedText),
    getEditorInputSnapshot: vi.fn(async () => ({
      value,
      selectedText,
      selectionStart: 0,
      selectionEnd: selectedText.length,
      revision,
    })),
    applyEditorInputEdit: vi.fn(
      async (
        snapshot: EditorInputSnapshot,
        text: string,
        scope: 'selection' | 'document'
      ) => {
        if (
          snapshot.revision !== revision ||
          snapshot.value !== value ||
          snapshot.selectedText !== selectedText
        )
          return false
        if (scope === 'selection') ctx.replaceEditorInputSelection(text)
        else ctx.setEditorInputValue(text)
        return true
      }
    ),
    setEditorInputValue: vi.fn((text: string) => {
      value = text
      selectedText = ''
      revision++
    }),
    replaceEditorInputSelection: vi.fn((text: string) => {
      value = text + value.slice(selectedText.length)
      selectedText = text
      revision++
    }),
    setEditorInputFocus: vi.fn(),
    toEditor: vi.fn(),
    toast: vi.fn(),
    callApiFunction: vi.fn<PluginContext['callApiFunction']>(
      async () => options.apiResult ?? { success: true }
    ),
    getMyConfig: vi.fn<PluginContext['getMyConfig']>(
      () => (options.config ?? {}) as ReturnType<PluginContext['getMyConfig']>
    ),
  }

  return { ctx: ctx satisfies PluginContext, mocks: ctx, toolbarItems, tools }
}
