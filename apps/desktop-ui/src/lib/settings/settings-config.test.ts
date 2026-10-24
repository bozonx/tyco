import { describe, expect, it } from 'vitest'
import { DEFAULT_APPEARANCE, DEFAULT_USER_CONFIG } from '@tyco/shared'

import { createSettingsConfig } from './settings-config'

const model = () =>
  createSettingsConfig({
    pluginFactories: () => [],
    appearance: () => DEFAULT_APPEARANCE,
  })
describe('settings config preparation', () => {
  it('keeps unknown fields, e.g. of a newer build, without mutating input', () => {
    const input = {
      ...structuredClone(DEFAULT_USER_CONFIG),
      editor: { ...DEFAULT_USER_CONFIG.editor, submitKey: 'invalid' },
      chatRoles: ['old'],
      registrationState: { seededToolIds: ['core.correct'] },
      aiRules: { chat: 'old' },
    }
    const original = structuredClone(input)
    const result = model().prepare(input)
    expect(input).toEqual(original)
    expect(result.editor.submitKey).toBe('Enter')
    expect(result).toHaveProperty('chatRoles', ['old'])
    expect(result).toHaveProperty('registrationState')
    expect(result).toHaveProperty('aiRules', { chat: 'old' })
    expect(result.markdown).toBeDefined()
  })
  it('normalizes malformed nested settings and filters invalid task fields', () => {
    const input = {
      ...structuredClone(DEFAULT_USER_CONFIG),
      aiTasks: {
        items: [
          null,
          42,
          { name: 123, rule: {} },
          { name: 123, rule: 'Translate', id: [] },
          { id: 'empty', name: ' ', rule: '' },
          { id: 'kept', name: '', rule: 'Shorten' },
        ],
        slots: { q: 'empty', t: 'kept', w: 'missing' },
      },
      llm: {
        ...structuredClone(DEFAULT_USER_CONFIG.llm),
        tasks: {
          ...structuredClone(DEFAULT_USER_CONFIG.llm.tasks),
          chat: { rule: [] },
          correction: 1,
        },
      },
      plugins: [],
      windowInsertion: { linux: { xdotoolPath: 42, pasteShortcut: {} } },
      hotkeys: {
        editor: 123,
        quickInput: 'Ctrl+W',
        selectionCorrection: false,
      },
      launcherPages: 'invalid',
      translation: { targetLanguages: 'invalid' },
      chat: { history: { retentionDays: -1, storage: false } },
      language: { ui: '', user: 7 },
      editor: { history: { maxItems: {} } },
    }
    const original = structuredClone(input)
    const result = model().prepare(input)
    expect(input).toEqual(original)
    expect(result.aiTasks).toEqual({
      items: [{ id: 'kept', name: '', rule: 'Shorten' }],
      slots: { t: 'kept' },
    })
    expect(result.llm.tasks).toEqual({
      ...DEFAULT_USER_CONFIG.llm.tasks,
      correction: { modelId: '', rule: '' },
    })
    expect(result.windowInsertion).toEqual(DEFAULT_USER_CONFIG.windowInsertion)
    expect(result.hotkeys.editor).toBe(DEFAULT_USER_CONFIG.hotkeys.editor)
    expect(result.hotkeys.quickInput).toBe('Ctrl+W')
    expect(result.hotkeys.selectionCorrection).toBe(
      DEFAULT_USER_CONFIG.hotkeys.selectionCorrection
    )
    expect(result.launcherPages).toEqual(DEFAULT_USER_CONFIG.launcherPages)
    expect(result.translation.targetLanguages).toEqual(
      DEFAULT_USER_CONFIG.translation.targetLanguages
    )
    expect(result.chat.history).toEqual(DEFAULT_USER_CONFIG.chat.history)
    expect(result.language).toEqual({ ui: 'auto' })
    expect(result.editor.history.maxItems).toBe(
      DEFAULT_USER_CONFIG.editor.history.maxItems
    )
    expect(model().prepare(result)).toEqual(result)
  })

  it.each([
    null,
    [],
    'invalid',
    42,
    { aiTasks: { q: { name: 123 } }, llm: { tasks: 7 } },
  ])('accepts incomplete or malformed settings: %j', (value) => {
    const result = model().prepare(value)
    expect(result.llm.tasks.chat.rule).toBeTypeOf('string')
    expect(result.windowInsertion.linux.xdotoolPath).toBeTypeOf('string')
    expect(Array.isArray(result.llm.models)).toBe(true)
    expect(model().prepare(result)).toEqual(result)
  })

  it('is idempotent', () => {
    const prepare = model().prepare
    const result = prepare(DEFAULT_USER_CONFIG)
    expect(prepare(result)).toEqual(result)
  })
})
