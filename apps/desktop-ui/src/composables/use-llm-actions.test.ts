import { expect, it, vi } from 'vitest'
import { useLlmActions } from './use-llm-actions'

const actions = vi.hoisted(() => ({
  correctText: vi.fn(),
  sendChatMessage: vi.fn(),
}))
vi.mock('../stores/llm', () => ({ useLlmStore: () => ({ actions }) }))

it('exposes the configured service without creating another actions instance', () => {
  expect(useLlmActions()).toBe(actions)
  expect(useLlmActions()).toBe(useLlmActions())
})
