import { describe, expect, it } from 'vitest'
import type { ActionItem } from '@tyco/plugin-sdk'
import { createResultActions } from './result-actions'

describe('result actions', () => {
  it('disables insertion without mutating configured shortcuts and preserves empty slots', () => {
    let available = false
    const insert: ActionItem = {
      id: 'insertIntoWindow',
      hint: 'Insert',
      action: async () => {},
    }
    const copy: ActionItem = { id: 'copy', action: async () => {} }
    const model = createResultActions({
      getShortcutActions: () => [insert, undefined, copy],
      getDefaultActions: () => [insert],
      hasTargetWindow: () => available,
      noTargetHint: () => 'No target',
    })
    expect(model.shortcutActions()).toEqual([
      { ...insert, disabled: true, hint: 'No target' },
      undefined,
      copy,
    ])
    expect(insert.disabled).toBeUndefined()
    expect(model.primaryAction()?.disabled).toBe(true)
    available = true
    expect(model.shortcutActions()[0]).toBe(insert)
    expect(model.primaryAction()).toMatchObject({
      disabled: false,
      hint: 'Insert',
    })
  })
  it('allows an empty action configuration', () => {
    const model = createResultActions({
      getShortcutActions: () => [],
      getDefaultActions: () => [],
      hasTargetWindow: () => false,
      noTargetHint: () => 'No target',
    })
    expect(model.primaryAction()).toBeUndefined()
    expect(model.shortcutActions()).toEqual([])
  })

  it('uses replaceInEditorAction as primaryAction when on the editor page', () => {
    const insert: ActionItem = {
      id: 'insertIntoWindow',
      action: async () => {},
    }
    const replaceInEditor: ActionItem = {
      id: 'applyToEditor',
      labelKey: 'menu.replaceInEditor',
      action: async () => {},
    }
    const model = createResultActions({
      getShortcutActions: () => [insert],
      getDefaultActions: () => [insert],
      hasTargetWindow: () => false,
      noTargetHint: () => 'No target',
      isEditorPage: () => true,
      replaceInEditorAction: replaceInEditor,
    })
    expect(model.primaryAction()).toBe(replaceInEditor)
  })
})
