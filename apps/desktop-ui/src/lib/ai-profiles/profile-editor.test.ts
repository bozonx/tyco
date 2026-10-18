import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { nextTick } from 'vue'
import type { AiProfile } from '@tyco/shared'

import { createProfileEditor } from './profile-editor'

const profile = { id: 'writer', name: 'Writer', temperature: 0.5 } as AiProfile

function setup(overrides: { readSoul?: () => Promise<string> } = {}) {
  const deps = {
    updateProfile: vi.fn().mockResolvedValue(undefined),
    readSoul: overrides.readSoul ?? vi.fn().mockResolvedValue('Be brief'),
    writeSoul: vi.fn().mockResolvedValue(undefined),
    reportError: vi.fn(),
    delayMs: 100,
  }
  return { deps, editor: createProfileEditor(deps) }
}

beforeEach(() => {
  vi.useFakeTimers()
})
afterEach(() => {
  vi.useRealTimers()
})

describe('profile editor', () => {
  it('fills the fields from the profile once', async () => {
    const { editor } = setup()
    await editor.load(profile)
    expect(editor.name.value).toBe('Writer')
    expect(editor.temperatureText.value).toBe('0.5')
    expect(editor.maxOutputTokensText.value).toBe('')
    expect(editor.soulPrompt.value).toBe('Be brief')

    editor.name.value = 'Typed'
    await editor.load({ ...profile, name: 'Stored' })
    expect(editor.name.value).toBe('Typed')
  })

  it('saves the settings a moment after the last change', async () => {
    const { deps, editor } = setup()
    await editor.load(profile)
    editor.name.value = ' Editor '
    editor.changeName()
    editor.changeTemperature('0.7')
    expect(editor.saveStatus.value).toBe('saving')
    await vi.advanceTimersByTimeAsync(100)

    expect(deps.updateProfile).toHaveBeenCalledOnce()
    expect(deps.updateProfile).toHaveBeenCalledWith({
      name: 'Editor',
      temperature: 0.7,
    })
    expect(editor.saveStatus.value).toBe('saved')
  })

  it('holds an invalid number back', async () => {
    const { deps, editor } = setup()
    await editor.load(profile)
    editor.changeMaxOutputTokens('lots')
    expect(editor.maxOutputTokensError.value).toBe(true)
    await vi.advanceTimersByTimeAsync(100)
    expect(deps.updateProfile).not.toHaveBeenCalled()
  })

  it('writes the soul only once it has been read', async () => {
    const { deps, editor } = setup({
      readSoul: vi.fn().mockRejectedValue(new Error('gone')),
    })
    await editor.load(profile)
    expect(deps.reportError).toHaveBeenCalledWith('Error: gone')
    editor.soulPrompt.value = 'New'
    editor.changeSoul()
    await editor.flush()
    expect(deps.writeSoul).not.toHaveBeenCalled()
  })

  it('reports a failed save and forgets cancelled changes', async () => {
    const { deps, editor } = setup()
    await editor.load(profile)
    deps.updateProfile.mockRejectedValueOnce(new Error('disk full'))
    editor.changeTemperature('1')
    await editor.flush()
    await nextTick()
    expect(editor.saveStatus.value).toBe('error')
    expect(deps.reportError).toHaveBeenCalledWith('disk full')

    editor.changeTemperature('0.2')
    editor.cancel()
    await vi.advanceTimersByTimeAsync(100)
    expect(deps.updateProfile).toHaveBeenCalledOnce()
  })
})
