import { vi, type Mock } from 'vitest'

import type {
  ActionItem,
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

/** Builds a plugin context whose editor text and settings are fixed. */
export function createPluginTestContext(
  options: PluginTestContextOptions = {}
): {
  ctx: PluginContext
  mocks: Record<string, Mock<(...args: any[]) => any>>
  toolbarItems: ToolbarItem[]
  tools: ToolDefinition[]
} {
  const toolbarItems: ToolbarItem[] = []
  const tools: ToolDefinition[] = []

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
    getEditorInputValue: vi.fn(() => options.value ?? ''),
    getEditorInputSelectedText: vi.fn(() => options.selectedText ?? ''),
    setEditorInputValue: vi.fn(),
    replaceEditorInputSelection: vi.fn(),
    setEditorInputFocus: vi.fn(),
    toast: vi.fn(),
    callApiFunction: vi.fn(async () => options.apiResult ?? { success: true }),
    getMyConfig: vi.fn(() => options.config),
  }

  return {
    ctx: ctx as unknown as PluginContext,
    mocks: ctx as unknown as Record<string, Mock<(...args: any[]) => any>>,
    toolbarItems,
    tools,
  }
}
