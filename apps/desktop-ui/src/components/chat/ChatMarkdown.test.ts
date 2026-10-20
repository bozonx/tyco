import { flushPromises, mount } from '@vue/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { i18n, setI18nLocale } from '../../lib/i18n/index'
import ChatMarkdown from './ChatMarkdown.vue'

const mocks = vi.hoisted(() => ({
  openLink: vi.fn(async () => ({ success: true, result: undefined })),
  diagram: vi.fn(async () => new Blob(['<svg/>'], { type: 'image/svg+xml' })),
}))
vi.mock('../../stores/ipc', () => ({
  useIpcStore: () => ({ callOrNotify: mocks.openLink }),
}))
vi.mock('../../lib/chat/chat-mermaid', () => ({
  renderChatMermaid: mocks.diagram,
}))
vi.mock('highlight.js', () => ({
  default: {
    getLanguage: () => true,
    highlight: (source: string) => ({
      value: `<span class="hljs-keyword">${source}</span>`,
    }),
    highlightAuto: (source: string) => ({ value: source }),
  },
}))

async function settle() {
  await flushPromises()
  await vi.advanceTimersByTimeAsync(110)
  await flushPromises()
}

const wrappers: ReturnType<typeof mount>[] = []
function render(content: string, streaming = false) {
  const wrapper = mount(ChatMarkdown, {
    props: { content, streaming },
    global: { plugins: [i18n] },
  })
  wrappers.push(wrapper)
  return wrapper
}

beforeEach(() => {
  vi.useFakeTimers()
  setI18nLocale('en_US')
  Object.defineProperty(URL, 'createObjectURL', {
    configurable: true,
    value: vi.fn(() => 'blob:preview'),
  })
  Object.defineProperty(URL, 'revokeObjectURL', {
    configurable: true,
    value: vi.fn(),
  })
})
afterEach(() => {
  wrappers.splice(0).forEach((wrapper) => wrapper.unmount())
  vi.useRealTimers()
  setI18nLocale('en_US')
})

describe('ChatMarkdown.vue', () => {
  it('writes streamed HTML to the root once per rendered update', async () => {
    const setter = vi.spyOn(Element.prototype, 'innerHTML', 'set')
    const wrapper = render('first', true)
    await settle()
    const writes = () =>
      setter.mock.contexts.filter((element) => element === wrapper.element)
        .length
    expect(writes()).toBe(1)
    await wrapper.setProps({ content: 'first second' })
    await vi.advanceTimersByTimeAsync(150)
    await settle()
    expect(writes()).toBe(2)
    expect(wrapper.text()).toContain('first second')
  })

  it('enhances code and refreshes button labels when the locale changes', async () => {
    const wrapper = render('```ts\nconst x = 1\n```')
    await settle()
    expect(wrapper.find('button').text()).toBe('Copy code')
    await wrapper.find('button').trigger('click')
    expect(wrapper.emitted('copy-code')?.[0]).toEqual(['const x = 1\n'])
    setI18nLocale('es_AR')
    await settle()
    expect(wrapper.find('button').text()).toBe(i18n.global.t('chat.copyCode'))
    expect(wrapper.findAll('button')).toHaveLength(1)
  })

  it('renders completed diagrams, retains source and notifies the chat when the image loads', async () => {
    const source = '```mermaid\ngraph TD; A-->B\n```'
    const wrapper = render(source, true)
    await settle()
    expect(mocks.diagram).not.toHaveBeenCalled()
    await wrapper.setProps({ streaming: false })
    await settle()
    expect(wrapper.find('figure img').attributes('src')).toBe('blob:preview')
    await wrapper.find('figure img').trigger('load')
    expect(wrapper.emitted('content-resized')).toHaveLength(1)
    await wrapper.find('button').trigger('click')
    expect(wrapper.emitted('copy-code')?.[0]).toEqual(['graph TD; A-->B\n'])
    wrapper.unmount()
    expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:preview')
  })

  it('opens links safely before deferred code enhancement has run', async () => {
    const wrapper = render('[Source](https://example.com)', true)
    await flushPromises()
    await wrapper.find('a').trigger('click')
    expect(mocks.openLink).toHaveBeenCalledWith('open_in_browser', {
      url: 'https://example.com',
    })
  })

  it('renders a streamed answer in batches, and at once when it ends', async () => {
    const wrapper = render('**One**', true)
    await settle()
    expect(wrapper.find('strong').text()).toBe('One')

    await wrapper.setProps({ content: '**Two**' })
    await flushPromises()
    expect(wrapper.find('strong').text()).toBe('One')
    await vi.advanceTimersByTimeAsync(150)
    await settle()
    expect(wrapper.find('strong').text()).toBe('Two')

    await wrapper.setProps({ content: '**Three**', streaming: false })
    await flushPromises()
    expect(wrapper.find('strong').text()).toBe('Three')
  })
})
