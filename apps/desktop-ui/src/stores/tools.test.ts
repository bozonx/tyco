import { createPinia, disposePinia, setActivePinia } from 'pinia'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { createInvocationRunner } from '../lib/invocation/invocation-runner'
import { useInvocationRunnerDependencies } from './invocations'
import { useIpcStore } from './ipc'
import { useChatStore } from './chat'
import { useToolsStore } from './tools'
import { useToastStore } from './toast'

let pinia: ReturnType<typeof createPinia>
beforeEach(() => {
  pinia = createPinia()
  setActivePinia(pinia)
})
afterEach(() => disposePinia(pinia))

describe('core insertion dependency wiring', () => {
  it('returns failure and reports once when the native paste fails', async () => {
    const ipc = useIpcStore()
    const call = vi
      .spyOn(ipc, 'callFunction')
      .mockResolvedValueOnce({ success: false, error: 'Target unavailable' })
      .mockResolvedValue({ success: true, result: undefined })
    const toast = vi.spyOn(useToastStore(), 'addToast')
    const runner = createInvocationRunner(useInvocationRunnerDependencies())
    const outcome = await runner.run(
      { toolId: 'core.insert', toolConfig: {}, label: 'Insert' },
      'Hello'
    )
    expect(outcome.success).toBe(false)
    expect(outcome.message).toContain('Target unavailable')
    expect(call).toHaveBeenCalledWith('pasteIntoTargetAndHide', ['Hello'])
    expect(call).toHaveBeenCalledWith('notifyDesktop', [
      expect.any(String),
      'Target unavailable',
    ])
    expect(toast).toHaveBeenCalledOnce()
  })
})

describe('lazy tool dependency ownership', () => {
  it('opens chat in its owner even when another Pinia becomes active', async () => {
    const owner = useChatStore(pinia)
    const attach = vi.spyOn(owner, 'attachToChat').mockResolvedValue()
    const tools = useToolsStore(pinia)
    const otherPinia = createPinia()
    try {
      const otherAttach = vi
        .spyOn(useChatStore(otherPinia), 'attachToChat')
        .mockResolvedValue()
      setActivePinia(otherPinia)
      const result = await tools
        .get('core.askInChat')!
        .run({
          input: { text: 'Owner context' },
          config: {},
          source: 'menu',
          signal: new AbortController().signal,
          wantsOutput: false,
        })
      expect(result.ok).toBe(true)
      expect(attach).toHaveBeenCalledExactlyOnceWith('Owner context')
      expect(otherAttach).not.toHaveBeenCalled()
    } finally {
      disposePinia(otherPinia)
    }
  })
})
