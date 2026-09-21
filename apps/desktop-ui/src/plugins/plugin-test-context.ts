import { vi } from 'vitest'

import type { PluginContext, ToolbarItem } from '../types/plugins'

export interface PluginTestContextOptions {
  value?: string
  selectedText?: string
  config?: Record<string, unknown>
  apiResult?: { success: boolean; error?: string }
}

/** Builds a plugin context whose editor text and settings are fixed. */
export function createPluginTestContext(
  options: PluginTestContextOptions = {}
) {
  const toolbarItems: ToolbarItem[] = []

  const ctx = {
    registerActionsItems: vi.fn(),
    registerEditItems: vi.fn(),
    registerCaseItems: vi.fn(),
    registerFormatItems: vi.fn(),
    registerToolbarItems: vi.fn((items: ToolbarItem[]) => {
      toolbarItems.push(...items)
    }),
    getEditorInputValue: vi.fn(() => options.value ?? ''),
    getEditorInputSelectedText: vi.fn(() => options.selectedText ?? ''),
    toast: vi.fn(),
    callApiFunction: vi.fn(async () => options.apiResult ?? { success: true }),
    getMyConfig: vi.fn(() => options.config),
  }

  return { ctx: ctx as unknown as PluginContext, mocks: ctx, toolbarItems }
}
