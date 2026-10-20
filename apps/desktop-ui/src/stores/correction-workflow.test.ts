import { createPinia, disposePinia, setActivePinia } from 'pinia'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { useCorrectionWorkflowStore } from './correction-workflow'
import { useHistoryStore } from './history'
import { useInvocationsStore } from './invocations'
import { MenuModals, useMenuModalsStore } from './menu-modals'

const mocks = vi.hoisted(() => ({ toastKey: vi.fn(), toastText: vi.fn() }))

vi.mock('./toast', () => ({
  useToastStore: () => ({
    addToast: vi.fn(),
    toastKey: mocks.toastKey,
    toastText: mocks.toastText,
  }),
}))

describe('useCorrectionWorkflowStore', () => {
  let pinia: ReturnType<typeof createPinia>

  beforeEach(() => {
    pinia = createPinia()
    setActivePinia(pinia)
    vi.clearAllMocks()
  })

  afterEach(() => {
    disposePinia(pinia)
  })

  it('runs correction step and opens insert modal on success', async () => {
    const invocations = useInvocationsStore()
    const history = useHistoryStore()
    const modals = useMenuModalsStore()

    vi.spyOn(invocations, 'call').mockResolvedValueOnce({
      ok: true,
      content: 'corrected text',
    })
    vi.spyOn(history, 'saveSource').mockResolvedValueOnce('src-1')
    vi.spyOn(history, 'saveSourceResult').mockResolvedValueOnce(undefined)
    const nextModalSpy = vi.spyOn(modals, 'nextModal').mockReturnValue(1)

    const store = useCorrectionWorkflowStore()
    await store.start('orig text')

    expect(invocations.call).toHaveBeenCalledWith(
      'core.correct',
      'orig text',
      expect.objectContaining({ signal: expect.any(AbortSignal) })
    )
    expect(history.saveSource).toHaveBeenCalledWith('orig text', 'correction')
    expect(history.saveSourceResult).toHaveBeenCalledWith(
      'src-1',
      'corrected text'
    )
    expect(nextModalSpy).toHaveBeenCalledWith(
      MenuModals.INSERT,
      expect.objectContaining({ text: 'corrected text' })
    )
  })

  it('reports error toast when correction invocation fails', async () => {
    const invocations = useInvocationsStore()
    vi.spyOn(invocations, 'call').mockResolvedValueOnce({
      ok: false,
      message: 'Backend error',
    })

    const store = useCorrectionWorkflowStore()
    await store.start('some text')

    expect(mocks.toastText).toHaveBeenCalled()
  })

  it('executes quick insert workflow successfully', async () => {
    const invocations = useInvocationsStore()
    const history = useHistoryStore()

    vi.spyOn(invocations, 'call').mockImplementation(async (toolId) => {
      if (toolId === 'core.correct') {
        return { ok: true, content: 'quick corrected' }
      }
      if (toolId === 'core.insert') {
        return { ok: true }
      }
      return { ok: false }
    })
    const saveOutputSpy = vi
      .spyOn(history, 'saveOutput')
      .mockResolvedValueOnce('out-1')

    const store = useCorrectionWorkflowStore()
    await store.insert('raw input')

    expect(invocations.call).toHaveBeenCalledWith(
      'core.correct',
      'raw input',
      expect.any(Object)
    )
    expect(saveOutputSpy).toHaveBeenCalledWith('quick corrected')
    expect(invocations.call).toHaveBeenCalledWith(
      'core.insert',
      'quick corrected'
    )
  })
})
