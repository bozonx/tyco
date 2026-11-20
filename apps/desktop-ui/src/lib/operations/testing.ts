import { errorMessage } from '@tyco/shared/value-guards'
import {
  type ScriptAndWebhookOperationDependencies,
  createScriptAndWebhookOperations,
} from './script-and-webhook-operations'
import { createCoreOperations } from './core-operations'
import { createOperationRegistry } from './operation-registry'
import type { OperationDefinition } from './operation-types'

/** A registry of `script` and `webhook` and the given tools, for tests */
export function testOperations(
  deps: ScriptAndWebhookOperationDependencies = {},
  extra: readonly OperationDefinition[] = []
) {
  return createOperationRegistry([
    ...createScriptAndWebhookOperations(deps),
    ...extra,
  ])
}

/** A core tool over the given dependencies; the others fail */
function testCoreOperation(
  id: 'core.copy' | 'core.insert' | 'core.translate',
  deps: {
    copyText?: (text: string) => Promise<void>
    insertText?: (text: string) => Promise<void>
    translateTo?: (language: string, text: string) => Promise<string>
  }
): OperationDefinition {
  const unused = () => Promise.reject(new Error('Not in this test'))
  return createCoreOperations({
    insertText: deps.insertText ?? unused,
    copyText: deps.copyText ?? unused,
    askInChat: unused,
    askInCurrentChat: unused,
    askInNewChat: unused,
    correctText: unused,
    translateTo: async (language, text) =>
      deps.translateTo
        ? { text: await deps.translateTo(language, text) }
        : unused(),
    transformationPrompt: unused,
    stylingPrompt: unused,
    getLlmUnavailableReasonKey: () => undefined,
    getTranslatorUnavailableReasonKey: () => undefined,
    describeError: (error) => errorMessage(error),
  }).find((tool) => tool.id === id)!
}

/** `core.copy` over `copyText`: the tool the clipboard sink of the runner runs */
export function testCopyOperation(
  copyText: (text: string) => Promise<void>
): OperationDefinition {
  return testCoreOperation('core.copy', { copyText })
}

/** `core.insert` over `insertText`: the tool the paste sink of the runner runs */
export function testInsertOperation(
  insertText: (text: string) => Promise<void>
): OperationDefinition {
  return testCoreOperation('core.insert', { insertText })
}

/** `core.translate` over `translateTo`; it fails without one */
export function testTranslateOperation(
  translateTo?: (language: string, text: string) => Promise<string>
): OperationDefinition {
  return testCoreOperation('core.translate', translateTo ? { translateTo } : {})
}
