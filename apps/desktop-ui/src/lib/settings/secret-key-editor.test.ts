import { describe, expect, it, vi } from 'vitest'

import { createSecretKeyEditor } from './secret-key-editor'

function setup() {
  const state = { id: 'provider', draft: ' key ' } as {
    id: string | undefined
    draft: string
  }
  const deps = {
    getSecretId: () => state.id,
    getDraft: () => state.draft,
    setDraft: (value: string) => {
      state.draft = value
    },
    setSecret: vi.fn(
      async (_id: string, _value: string, _origins?: string[]) => {}
    ),
    removeSecret: vi.fn(async (_id: string) => {}),
    reportError: vi.fn(),
    onSaved: vi.fn(),
    onRemoved: vi.fn(),
  }
  return { state, deps, editor: createSecretKeyEditor(deps) }
}

describe('secret key editor', () => {
  it('trims saved keys, binds their origins and clears the submitted draft', async () => {
    const { editor, state, deps } = setup()
    await editor.save(['https://example.com'])
    expect(deps.setSecret).toHaveBeenCalledWith('provider', 'key', [
      'https://example.com',
    ])
    expect(state.draft).toBe('')
    expect(deps.onSaved).toHaveBeenCalledWith('key')
    await editor.remove()
    expect(deps.removeSecret).toHaveBeenCalledWith('provider')
    expect(deps.onRemoved).toHaveBeenCalledOnce()
  })

  it('ignores unavailable providers and empty drafts', async () => {
    const { editor, state, deps } = setup()
    state.draft = ' '
    await editor.save()
    state.draft = 'key'
    state.id = undefined
    await editor.save()
    await editor.remove()
    expect(deps.setSecret).not.toHaveBeenCalled()
    expect(deps.removeSecret).not.toHaveBeenCalled()
  })

  it('retains drafts and reports save and removal failures', async () => {
    const { editor, state, deps } = setup()
    const error = new Error('Unavailable')
    deps.setSecret.mockRejectedValue(error)
    deps.removeSecret.mockRejectedValue(error)
    await editor.save()
    await editor.remove()
    expect(state.draft).toBe(' key ')
    expect(deps.reportError).toHaveBeenCalledTimes(2)
    expect(deps.reportError).toHaveBeenCalledWith(error)
    expect(deps.onSaved).not.toHaveBeenCalled()
    expect(deps.onRemoved).not.toHaveBeenCalled()
  })

  it('preserves edits made during a save and ignores completion for a different provider', async () => {
    const { editor, state, deps } = setup()
    let finish!: () => void
    deps.setSecret.mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          finish = resolve
        })
    )
    const pending = editor.save()
    state.draft = 'new key'
    finish()
    await pending
    expect(state.draft).toBe('new key')
    expect(deps.onSaved).toHaveBeenCalledOnce()

    const another = editor.save()
    state.id = 'another-provider'
    finish()
    await another
    expect(state.draft).toBe('new key')
    expect(deps.onSaved).toHaveBeenCalledOnce()
  })

  it('does not apply removal side effects to a newly selected provider', async () => {
    const { editor, state, deps } = setup()
    let finish!: () => void
    deps.removeSecret.mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          finish = resolve
        })
    )
    const pending = editor.remove()
    state.id = 'another-provider'
    finish()
    await pending
    expect(deps.removeSecret).toHaveBeenCalledWith('provider')
    expect(deps.onRemoved).not.toHaveBeenCalled()
  })
})
