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

/** A core tool over the given dependencies; the others fail */
function testCoreTool(
  id: 'core.copy' | 'core.insert',
  deps: { copyText?: (text: string) => Promise<void> } & {
    insertText?: (text: string) => Promise<void>
  }
): ToolDefinition {
  const unused = () => Promise.reject(new Error('Not in this test'))
  return createCoreTools({
    insertText: deps.insertText ?? unused,
    copyText: deps.copyText ?? unused,
    askInChat: unused,
    correctText: unused,
    translateTo: unused,
    aiCustomPrompt: unused,
    llmUnavailable: () => undefined,
    translatorUnavailable: () => undefined,
    describeError: (error) =>
      error instanceof Error ? error.message : String(error),
  }).find((tool) => tool.id === id)!
}

/** `core.copy` over `copyText`: the tool the clipboard sink of the runner runs */
export function testCopyTool(
  copyText: (text: string) => Promise<void>
): ToolDefinition {
  return testCoreTool('core.copy', { copyText })
}

/** `core.insert` over `insertText`: the tool the paste sink of the runner runs */
export function testInsertTool(
  insertText: (text: string) => Promise<void>
): ToolDefinition {
  return testCoreTool('core.insert', { insertText })
}
