import {
  PluginCancellation,
  PluginError,
  type ActionItem,
  type EditItem,
} from '@tyco/plugin-sdk'
import { describe, expect, it, vi } from 'vitest'
import { proxyRefs } from 'vue'

import { createEditorInputModel } from '../editor-input/editor-input-model'
import {
  createEditorActions,
  type EditorActionsDependencies,
} from './editor-actions'

function setup() {
  const editor = proxyRefs(createEditorInputModel())
  editor.setValue('before selected after')
  editor.setSelection('selected', 7, 15)
  const openVoice = vi.fn<EditorActionsDependencies['openVoice']>()
  const closeVoice = vi.fn()
  const toastKey = vi.fn()
  const actions = createEditorActions({
    editor,
    openVoice,
    closeVoice,
    toastKey,
    t: (key) => `translated:${key}`,
  })
  return { actions, editor, openVoice, closeVoice, toastKey }
}

describe('editor actions', () => {
  it('captures an action source before it can move to an identical selection', async () => {
    const { editor, actions } = setup()
    editor.setValue('old old')
    editor.setSelection('old', 0, 3)
    await actions.doAction({ action: async () => {} })
    editor.setSelection('old', 4, 7)
    expect(editor.applyResult('new', 'old')).toBe(false)
    expect(editor.value).toBe('old old')
  })
  it('replaces the captured voice selection and focuses at the end of the inserted text', () => {
    const { actions, editor, openVoice, closeVoice } = setup()
    actions.voiceRecognition()
    const params = openVoice.mock.calls[0]![0]
    expect(params.inline).toBe(true)
    params.onCorrected('spoken text')
    expect(editor.value).toBe('before spoken text after')
    expect(editor.selectionStart).toBe(18)
    expect(editor.selectionEnd).toBe(18)
    expect(editor.selectedText).toBe('')
    expect(editor.lastEditSource).toBe('voice')
    expect(editor.focusRequestCount).toBe(1)
    expect(closeVoice).toHaveBeenCalledOnce()
  })

  it('inserts voice text at a collapsed cursor', () => {
    const { actions, editor, openVoice } = setup()
    editor.setSelection('', 0, 0)
    actions.voiceRecognition()
    openVoice.mock.calls[0]![0].onCorrected('Hello ')
    expect(editor.value).toBe('Hello before selected after')
    expect(editor.selectionStart).toBe(6)
  })

  it('keeps a space between the dictated text and the word before it', () => {
    const { actions, editor, openVoice } = setup()
    editor.setValue('Hello')
    editor.setSelection('', 5, 5)
    actions.voiceRecognition()
    openVoice.mock.calls[0]![0].onCorrected('world')
    expect(editor.value).toBe('Hello world')
    expect(editor.selectionStart).toBe(11)
  })

  it('keeps changes made to the editor while dictating', () => {
    const { actions, editor, openVoice } = setup()
    actions.voiceRecognition()
    editor.setValue('synced text')
    editor.setSelection('', 11, 11)
    openVoice.mock.calls[0]![0].onCorrected('spoken')
    expect(editor.value).toBe('synced text spoken')
  })

  it.each(['empty', 'cancel'] as const)(
    'closes voice input without editing on %s',
    (kind) => {
      const { actions, editor, openVoice, closeVoice } = setup()
      actions.voiceRecognition()
      const params = openVoice.mock.calls[0]![0]
      if (kind === 'empty') params.onCorrected('  ')
      else params.onCancel()
      expect(editor.value).toBe('before selected after')
      expect(editor.focusRequestCount).toBe(0)
      expect(closeVoice).toHaveBeenCalledOnce()
    }
  )

  it('resolves translated labels and explicit names', () => {
    const { actions } = setup()
    expect(
      actions.getLabel({ id: 'a', labelKey: 'label', action: vi.fn() })
    ).toBe('translated:label')
    expect(actions.getLabel({ id: 'a', name: 'Name', action: vi.fn() })).toBe(
      'Name'
    )
    expect(actions.getLabel({ id: 'a', action: vi.fn() })).toBe('')
  })

  it('uses selection or full text and respects whitespace preservation', async () => {
    const { actions, editor } = setup()
    editor.setValue('  full text  ')
    editor.setSelection(' full ', 1, 7)
    const action = vi.fn(async () => {})
    const item: ActionItem = { id: 'action', action }
    await actions.doAction(item)
    expect(action).toHaveBeenLastCalledWith('full')
    await actions.doAction({ ...item, preserveWhitespace: true })
    expect(action).toHaveBeenLastCalledWith(' full ')
    await actions.doAction({ ...item, useFullEditorText: true })
    expect(action).toHaveBeenLastCalledWith('full text')
  })

  it('applies a formatter result to the selection as an AI edit', async () => {
    const { actions, editor, toastKey } = setup()
    await actions.doEdit({
      id: 'upper',
      action: async (text) => text.toUpperCase(),
    })
    expect(editor.value).toBe('before SELECTED after')
    expect(editor.lastEditSource).toBe('ai')
    expect(toastKey).not.toHaveBeenCalled()
  })

  it('reports an empty selection without running the formatter', async () => {
    const { actions, editor, toastKey } = setup()
    editor.setSelection('', 0, 0)
    const action = vi.fn(async () => 'result')
    await actions.doEdit({ id: 'selection', selectionOnly: true, action })
    expect(action).not.toHaveBeenCalled()
    expect(toastKey).toHaveBeenCalledWith('toast.textNotSelected', 'warn')
  })

  it('rejects a delayed edit after the document changes', async () => {
    const { actions, editor, toastKey } = setup()
    let resolve!: (text: string) => void
    const pending = actions.doEdit({
      id: 'slow',
      action: () =>
        new Promise<string>((done) => {
          resolve = done
        }),
    })
    editor.setValue('new draft')
    resolve('late result')
    await pending
    expect(editor.value).toBe('new draft')
    expect(toastKey).toHaveBeenCalledWith('toast.textTransformStale', 'warn')
  })

  it.each([
    { error: new PluginCancellation(), expected: null },
    {
      error: new PluginError('plugin.failed'),
      expected: ['plugin.failed', 'error'],
    },
    {
      error: new Error('failed'),
      expected: ['toast.textTransformFailed', 'error', { detail: 'failed' }],
    },
  ])('handles formatter failure $error', async ({ error, expected }) => {
    const { actions, editor, toastKey } = setup()
    const item: EditItem = {
      id: 'failing',
      action: async () => {
        throw error
      },
    }
    await actions.doEdit(item)
    expect(editor.value).toBe('before selected after')
    if (expected) expect(toastKey.mock.calls).toEqual([expected])
    else expect(toastKey).not.toHaveBeenCalled()
  })
})

it('resolves the public label field and gives translation keys priority', () => {
  const { actions } = setup()
  expect(actions.getLabel({ label: 'Label', action: async () => {} })).toBe(
    'Label'
  )
  expect(
    actions.getLabel({
      label: 'Label',
      labelKey: 'edit.uppercase',
      action: async () => {},
    })
  ).toBe('translated:edit.uppercase')
})
