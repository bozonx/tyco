import { createPinia, disposePinia, setActivePinia } from 'pinia'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { SelectionRunEvent } from '@tyco/shared'

import { useSelectionReplaceStore } from './selection-replace'
import { useIpcStore } from './ipc'
import { useInvocationsStore } from './invocations'

let pinia: ReturnType<typeof createPinia>

beforeEach(() => {
  pinia = createPinia()
  setActivePinia(pinia)
  vi.clearAllMocks()
})

afterEach(() => {
  disposePinia(pinia)
})

describe('selection replace store wiring', () => {
  it('wires action, runner, invocations and IPC correctly on handleRun', async () => {
    const ipc = useIpcStore()
    const invocations = useInvocationsStore()

    const callFunctionSpy = vi
      .spyOn(ipc, 'callFunction')
      .mockImplementation(async (name: string) => {
        if (name === 'finishSelectionRun') {
          return { success: true, result: 'pasted' as any }
        }
        return { success: true, result: undefined as any }
      })

    const callSpy = vi
      .spyOn(invocations, 'call')
      .mockResolvedValue({ ok: true, content: 'corrected text' })

    const store = useSelectionReplaceStore()

    const event: SelectionRunEvent = {
      runId: 42,
      action: 'correction',
      text: 'teh text',
      userConfig: ipc.desktopState.userConfig,
    }

    await store.handleRun(event)

    expect(callSpy).toHaveBeenCalledWith(
      'core.correct',
      'teh text',
      expect.objectContaining({ source: 'selection' })
    )
    expect(callFunctionSpy).toHaveBeenCalledWith('finishSelectionRun', [
      42,
      'corrected text',
    ])
  })

  it('handles cancellation and aborts active run', async () => {
    const ipc = useIpcStore()
    const store = useSelectionReplaceStore()
    const callFunctionSpy = vi
      .spyOn(ipc, 'callFunction')
      .mockResolvedValue({ success: true, result: undefined as any })

    store.handleCancel(99)

    expect(callFunctionSpy).toHaveBeenCalledWith(
      'showStatusOverlay',
      expect.anything()
    )
  })
})
