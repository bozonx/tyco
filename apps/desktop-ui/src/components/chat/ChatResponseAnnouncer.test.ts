import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'

import ChatResponseAnnouncer from './ChatResponseAnnouncer.vue'

const message = { role: 'assistant' as const, content: 'Existing answer' }

describe('ChatResponseAnnouncer', () => {
  it('announces only the completed response, including repeated answers', async () => {
    const wrapper = mount(ChatResponseAnnouncer, {
      props: { chatId: 'chat', isGenerating: false, message },
    })
    expect(wrapper.text()).toBe('')
    expect(wrapper.attributes('role')).toBe('status')
    await wrapper.setProps({ isGenerating: true })
    await wrapper.setProps({ message: { ...message, content: 'Partial' } })
    expect(wrapper.text()).toBe('')
    await wrapper.setProps({
      message: { ...message, content: 'Complete answer' },
      isGenerating: false,
    })
    expect(wrapper.text()).toBe('Complete answer')
    await wrapper.setProps({ isGenerating: true })
    expect(wrapper.text()).toBe('')
    await wrapper.setProps({ isGenerating: false })
    expect(wrapper.text()).toBe('Complete answer')
    wrapper.unmount()
  })

  it('clears announcements when switching chats and does not read existing history', async () => {
    const wrapper = mount(ChatResponseAnnouncer, {
      props: { chatId: 'first', isGenerating: true, message },
    })
    await wrapper.setProps({ chatId: 'second', isGenerating: false })
    expect(wrapper.text()).toBe('')
    await wrapper.setProps({ isGenerating: true })
    await wrapper.setProps({ isGenerating: false })
    expect(wrapper.text()).toBe(message.content)
    await wrapper.setProps({ chatId: 'third' })
    expect(wrapper.text()).toBe('')
    wrapper.unmount()
  })

  it('does not announce a user message after a failed generation', async () => {
    const wrapper = mount(ChatResponseAnnouncer, {
      props: {
        chatId: 'chat',
        isGenerating: true,
        message: { role: 'user', content: 'Question' },
      },
    })
    await wrapper.setProps({ isGenerating: false })
    expect(wrapper.text()).toBe('')
    wrapper.unmount()
  })
})
