import { vi, type Mock } from 'vitest'

import type {
  ActionItem,
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
    registerActionsItems: vi.fn<(items: ActionItem[]) => void>(),
    registerEditItems: vi.fn(),
    registerCaseItems: vi.fn(),
    registerFormatItems: vi.fn(),
    registerToolbarItems: vi.fn((items: ToolbarItem[]) => {
      toolbarItems.push(...items)
    }),
    registerTools: vi.fn((items: ToolDefinition[]) => {
      tools.push(...items)
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
