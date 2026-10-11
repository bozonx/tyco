import {
  type BuiltinToolDependencies,
  createBuiltinTools,
} from './builtin-tools'
import { createCoreTools } from './core-tools'
import { createToolRegistry } from './tool-registry'
import type { ToolDefinition } from './tool-types'

/** A registry of `script` and `webhook` and the given tools, for tests */
export function testTools(
  deps: BuiltinToolDependencies = {},
  extra: readonly ToolDefinition[] = []
) {
  return createToolRegistry([...createBuiltinTools(deps), ...extra])
}

/** `core.copy` over `copyText`: the tool the clipboard sink of the runner runs */
export function testCopyTool(
  copyText: (text: string) => Promise<void>
): ToolDefinition {
  const unused = () => Promise.reject(new Error('Not in this test'))
  return createCoreTools({
    insertText: unused,
    copyText,
    askInChat: unused,
    correctText: unused,
    translateTo: unused,
    aiCustomPrompt: unused,
    llmUnavailable: () => undefined,
    translatorUnavailable: () => undefined,
    describeError: (error) =>
      error instanceof Error ? error.message : String(error),
  }).find((tool) => tool.id === 'core.copy')!
}
