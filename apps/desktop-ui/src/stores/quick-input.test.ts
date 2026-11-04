import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { loadFakeDesktop } from '../test/install-fake-desktop'
import { useQuickInputStore } from './quick-input'
import { useHistoryStore } from './history'

let desktop: Awaited<ReturnType<typeof loadFakeDesktop>>
beforeEach(async () => {
  desktop = await loadFakeDesktop()
  desktop.setState({ mode: 'quickInput' })
  vi.useFakeTimers()
})
afterEach(() => {
  desktop.dispose()
  vi.useRealTimers()
})

function turnHistoryOff() {
  desktop.setUserConfig({
    editor: {
      ...desktop.backend.userConfig.editor,
      history: { ...desktop.backend.userConfig.editor.history, storage: 'off' },
    },
  })
}

describe('quick input recovery', () => {
  it('checkpoints one record and retains cancelled text in history', async () => {
    const input = useQuickInputStore()
    input.setValue('First paragraph')
    await vi.advanceTimersByTimeAsync(5000)
    input.setValue('First paragraph. Second paragraph.')
    input.discard()
    await useHistoryStore().flushInputs()
    expect(input.value).toBe('')
    expect(desktop.backend.history).toHaveLength(1)
    expect(desktop.backend.history[0]).toMatchObject({
      text: 'First paragraph. Second paragraph.',
      kind: 'draft',
      origin: 'quickInput',
    })
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

  it('keeps the text until it leaves the app', async () => {
    const input = useQuickInputStore()
    input.setValue('Not inserted yet')
    // a failed or cancelled insertion: nothing left the app
    expect(input.startSession()).toBe(true)
    expect(input.value).toBe('Not inserted yet')

    await useHistoryStore().saveOutput('Not inserted yet')
    expect(input.startSession()).toBe(false)
    expect(input.value).toBe('')
  })

  it('is not finished by a text leaving another mode', async () => {
    const input = useQuickInputStore()
    input.setValue('Typed')
    desktop.setState({ mode: 'translation' })
    await useHistoryStore().saveOutput('Translated')
    expect(input.startSession()).toBe(true)
    expect(input.value).toBe('Typed')
  })

  it('stores nothing with the history turned off', async () => {
    turnHistoryOff()
    const input = useQuickInputStore()
    input.setValue('Private words')
    await vi.advanceTimersByTimeAsync(5000)
    // unfinished text stays in the input itself, nowhere else
    expect(input.startSession()).toBe(true)
    expect(input.value).toBe('Private words')
    await input.saveSource('Private words', 'correction')
    input.discard()
    await useHistoryStore().saveOutput('Private words')
    await useHistoryStore().flushInputs()
    await vi.advanceTimersByTimeAsync(60_000)
    expect(desktop.backend.history).toHaveLength(0)
    expect(input.value).toBe('')
    expect(input.startSession()).toBe(false)
    expect(input.value).toBe('')
  })
})

it('starts a fresh history record after the text was sent', async () => {
  const input = useQuickInputStore()
  input.setValue('First submission')
  await input.flushHistory()
  await useHistoryStore().saveOutput('First submission', 'quickInput')
  const firstId = desktop.backend.history[0]?.id
  expect(desktop.backend.history[0]?.kind).toBe('output')
  input.startSession()
  input.setValue('Second input')
  await input.flushHistory()
  expect(desktop.backend.history[0]?.id).not.toBe(firstId)
  expect(desktop.backend.history[0]?.text).toBe('Second input')
})
