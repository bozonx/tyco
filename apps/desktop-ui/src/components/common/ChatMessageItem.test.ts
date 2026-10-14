import { shallowMount } from '@vue/test-utils'
import { expect, it, vi } from 'vitest'

import ChatMessageItem from './ChatMessageItem.vue'

vi.mock('../../composables/use-i18n', () => ({
  useI18n: () => ({ t: (key: string) => key }),
}))
vi.mock('../../composables/use-toast', () => ({
  default: () => ({ toastKey: vi.fn() }),
}))

it('offers regeneration only for assistant messages when enabled', async () => {
  const wrapper = shallowMount(ChatMessageItem, {
    props: {
      message: { role: 'assistant', content: 'Answer' },
      canRegenerate: true,
    },
  })
  const actions = () =>
    wrapper.findComponent({ name: 'DropdownMenu' }).props('items') as Array<{
      label: string
      action: () => void
    }>
  actions()
    .find((item) => item.label === 'chat.regenerate')!
    .action()
  expect(wrapper.emitted('regenerate')).toHaveLength(1)
  await wrapper.setProps({ canRegenerate: false })
  expect(actions().some((item) => item.label === 'chat.regenerate')).toBe(false)
  await wrapper.setProps({
    canRegenerate: true,
    message: { role: 'user', content: 'Question' },
  })
  expect(actions().some((item) => item.label === 'chat.regenerate')).toBe(false)
  wrapper.unmount()
})
