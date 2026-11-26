import { emit } from '@tauri-apps/api/event'
import { flushPromises, mount } from '@vue/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import {
  DESKTOP_EVENTS,
  type SubtitlesSnapshot,
  type SubtitlesView,
} from '@tyco/shared'
import {
  loadFakeDesktop,
  type TestDesktop,
} from '../../test/install-fake-desktop'
import IconButton from '../common/IconButton.vue'
import SubtitlesOverlay from './SubtitlesOverlay.vue'

describe('SubtitlesOverlay.vue', () => {
  let desktop: TestDesktop

  beforeEach(async () => {
    vi.stubGlobal(
      'ResizeObserver',
      class {
        observe = vi.fn()
        unobserve = vi.fn()
        disconnect = vi.fn()
      }
    )
    desktop = await loadFakeDesktop({}, 'subtitles')
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    desktop.dispose()
  })

  it('renders subtitles and only the expand button, with no recording indicator or stop button', async () => {
    const testView: SubtitlesView = {
      mainText: 'Hello world',
      mainLang: 'en-US',
      pendingText: ' pending',
      secondaryText: 'Привет мир',
      placeholder: 'Listening…',
      errorText: '',
      isActive: true,
      stopLabel: 'Stop',
      expandLabel: 'Expand',
      recordingStartedAt: 12345678,
      recordingLabel: 'Recording',
    }

    desktop.backend.handle(
      'get_subtitles',
      () => ({ view: testView, isAnchored: false }) as SubtitlesSnapshot
    )
    desktop.backend.handle('set_subtitles_input_region', () => undefined)
    desktop.backend.handle('request_subtitles_action', () => undefined)

    const wrapper = mount(SubtitlesOverlay)
    await flushPromises()

    // Subtitles texts are rendered
    expect(wrapper.text()).toContain('Hello world')
    expect(wrapper.text()).toContain('pending')
    expect(wrapper.text()).toContain('Привет мир')
    expect(wrapper.find('.subtitles-main-scroll').classes()).toContain(
      'has-secondary'
    )

    // Only one action button is rendered: Expand button
    const buttons = wrapper.findAllComponents(IconButton)
    expect(buttons).toHaveLength(1)
    expect(buttons[0]!.props('icon')).toBe('mdi:arrow-expand')
    expect(buttons[0]!.props('label')).toBe('Expand')

    // No stop button or recording indicator
    expect(wrapper.find('.subtitles-recording').exists()).toBe(false)
    expect(
      wrapper
        .findAllComponents(IconButton)
        .some((b) => b.props('icon') === 'mdi:stop')
    ).toBe(false)

    // Clicking expand triggers requestAction('expand')
    await buttons[0]!.trigger('click')
    await flushPromises()

    const calls = desktop.backend.callsOf('request_subtitles_action')
    expect(calls).toEqual([{ action: 'expand' }])
  })

  it('updates text when DESKTOP_EVENTS.SUBTITLES_CHANGED is emitted', async () => {
    desktop.backend.handle('get_subtitles', () => ({
      view: null,
      isAnchored: false,
    }))
    desktop.backend.handle('set_subtitles_input_region', () => undefined)

    const wrapper = mount(SubtitlesOverlay)
    await flushPromises()

    expect(wrapper.text()).toBe('')

    const updatedView: SubtitlesView = {
      mainText: 'Live subtitle update',
      mainLang: null,
      pendingText: '',
      secondaryText: '',
      placeholder: 'Listening…',
      errorText: '',
      isActive: true,
      stopLabel: 'Stop',
      expandLabel: 'Expand',
      recordingStartedAt: null,
      recordingLabel: '',
    }

    await emit(DESKTOP_EVENTS.SUBTITLES_CHANGED, updatedView)
    await flushPromises()

    expect(wrapper.text()).toContain('Live subtitle update')
    expect(wrapper.find('.subtitles-main-scroll').classes()).not.toContain(
      'has-secondary'
    )
    const buttons = wrapper.findAllComponents(IconButton)
    expect(buttons).toHaveLength(1)
    expect(buttons[0]!.props('icon')).toBe('mdi:arrow-expand')
  })
})
