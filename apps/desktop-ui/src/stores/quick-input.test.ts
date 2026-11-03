import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { loadFakeDesktop } from '../test/install-fake-desktop'
import { useQuickInputStore } from './quick-input'
import { useHistoryStore } from './history'

let desktop: Awaited<ReturnType<typeof loadFakeDesktop>>
beforeEach(async () => {
  desktop = await loadFakeDesktop()
  vi.useFakeTimers()
})
afterEach(() => {
  desktop.dispose()
  vi.useRealTimers()
})

describe('quick input recovery', () => {
  it('checkpoints one record and retains cancelled text in history', async () => {
    const input = useQuickInputStore()
    input.setValue('First paragraph')
    await vi.advanceTimersByTimeAsync(10000)
    input.setValue('First paragraph. Second paragraph.')
    input.discard()
    await useHistoryStore().flushInputs()
    expect(input.value).toBe('')
    expect(input.recallText).toBe('First paragraph. Second paragraph.')
    expect(desktop.backend.history).toHaveLength(1)
    expect(desktop.backend.history[0]?.text).toBe(
      'First paragraph. Second paragraph.'
    )
  })
  it('flushes before shutdown and promotes the checkpoint before AI processing', async () => {
    const input = useQuickInputStore()
    input.setValue('Raw input')
    expect(await useHistoryStore().flushInputs()).toBe(true)
    const id = desktop.backend.history[0]?.id
    expect(await input.saveSource('Raw input', 'correction')).toBe(id)
    expect(desktop.backend.history).toHaveLength(1)
    expect(desktop.backend.history[0]?.kind).toBe('source')
  })
  it('retains unfinished text on reactivation and respects disabled history', async () => {
    desktop.setUserConfig({
      editor: {
        ...desktop.backend.userConfig.editor,
        history: {
          ...desktop.backend.userConfig.editor.history,
          storage: 'off',
        },
      },
    })
    const input = useQuickInputStore()
    input.setValue('Keep in memory')
    expect(input.startSession()).toBe(true)
    await useHistoryStore().flushInputs()
    expect(input.value).toBe('Keep in memory')
    expect(desktop.backend.history).toHaveLength(0)
    input.clear()
  })
})

it('starts a fresh history record after submitting without correction', async () => {
  const input = useQuickInputStore()
  input.setValue('First submission')
  input.rememberSubmitted(input.value)
  await input.flushHistory()
  const firstId = desktop.backend.history[0]?.id
  input.startSession()
  input.setValue('Second input')
  await input.flushHistory()
  expect(desktop.backend.history[0]?.id).not.toBe(firstId)
  expect(desktop.backend.history[0]?.text).toBe('Second input')
})
