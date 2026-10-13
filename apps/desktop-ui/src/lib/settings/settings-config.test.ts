import { describe, expect, it } from 'vitest'
import { DEFAULT_APPEARANCE, DEFAULT_USER_CONFIG } from '@tyco/shared'

import { createSettingsConfig } from './settings-config'

const model = () =>
  createSettingsConfig({
    resolveMainActions: (actions) => actions ?? [],
    getRegisteredActions: () => [{ id: 'new-action' }],
    pluginIndexes: () => [],
    appearance: () => DEFAULT_APPEARANCE,
  })
describe('settings config preparation', () => {
  it('normalizes legacy fields without mutating input', () => {
    const input = {
      ...structuredClone(DEFAULT_USER_CONFIG),
      submitKey: 'invalid',
      chatRoles: ['old'],
      aiRules: { ...DEFAULT_USER_CONFIG.aiRules, base: 'old' },
    }
    const original = structuredClone(input)
    const result = model().prepare(input)
    expect(input).toEqual(original)
    expect(result.submitKey).toBe('enter')
    expect(result).not.toHaveProperty('chatRoles')
    expect(result.aiRules).not.toHaveProperty('base')
    expect(result.registrationState?.reviewedMainActionIds).toContain(
      'new-action'
    )
    expect(result.markdown).toBeDefined()
  })
  it('normalizes malformed nested settings and filters invalid task fields', () => {
    const input = {
      ...structuredClone(DEFAULT_USER_CONFIG),
      aiTasks: [
        null,
        42,
        { name: 123, rule: {} },
        { name: 123, rule: 'Translate', id: [] },
      ],
      aiRules: { chat: [], correction: 1 },
      plugins: [],
      windowInsertion: { xdotoolBin: 42, ydotoolBin: null, pasteShortcut: {} },
      hotkeys: { editor: 123, write: 'Ctrl+W' },
      selectionHotkeys: { correction: false },
      launcherPages: 'invalid',
      launcherPagesWithoutText: [null, -1, '2', 1.5, 2],
      registrationState: { reviewedMainActionIds: 'invalid' },
      toTranslateLanguages: 'invalid',
      chatHistoryRetentionDays: -1,
      chatHistoryEnabled: 'false',
      editorHistoryMaxItems: {},
    }
    const original = structuredClone(input)
    const result = model().prepare(input)
    expect(input).toEqual(original)
    expect(result.aiTasks.slice(0, 4)).toEqual([
      null,
      null,
      null,
      { id: 'task-1', name: '', rule: 'Translate' },
    ])
    expect(result.aiRules).toEqual(DEFAULT_USER_CONFIG.aiRules)
    expect(result.windowInsertion).toEqual(DEFAULT_USER_CONFIG.windowInsertion)
    expect(result.hotkeys.editor).toBe(DEFAULT_USER_CONFIG.hotkeys.editor)
    expect(result.hotkeys.write).toBe('Ctrl+W')
    expect(result.launcherPages).toEqual([])
    expect(result.launcherPagesWithoutText).toEqual([])
    expect(result.chatHistoryEnabled).toBe(
      DEFAULT_USER_CONFIG.chatHistoryEnabled
    )
    expect(result.chatHistoryRetentionDays).toBe(
      DEFAULT_USER_CONFIG.chatHistoryRetentionDays
    )
    expect(result.editorHistoryMaxItems).toBe(
      DEFAULT_USER_CONFIG.editorHistoryMaxItems
    )
    expect(model().prepare(result)).toEqual(result)
  })

  it.each([null, [], 'invalid', 42, { aiTasks: [{ name: 123 }], aiRules: 7 }])(
    'accepts incomplete or malformed settings: %j',
    (value) => {
      const result = model().prepare(value)
      expect(result.aiRules.chat).toBeTypeOf('string')
      expect(result.windowInsertion.xdotoolBin).toBeTypeOf('string')
      expect(Array.isArray(result.llm.models)).toBe(true)
      expect(model().prepare(result)).toEqual(result)
    }
  )

  it('is idempotent', () => {
    const prepare = model().prepare
    const result = prepare(DEFAULT_USER_CONFIG)
    expect(prepare(result)).toEqual(result)
  })
})
