import { mount } from '@vue/test-utils'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import HistoryList, { type HistoryListItem } from './HistoryList.vue'

vi.mock('../../composables/use-i18n', () => ({
  useI18n: () => ({
    t: (key: string, params?: Record<string, unknown>) =>
      params ? `${key}:${JSON.stringify(params)}` : key,
    locale: { value: 'en-US' },
  }),
}))

describe('HistoryList.vue', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  const sampleItems: HistoryListItem[] = [
    { id: '1', value: 'First item short text', time: Date.now() - 1000 },
    {
      id: '2',
      value: 'Second item with long content '.repeat(20),
      original: { label: 'Original', text: 'Original text' },
      time: Date.now() - 5000,
    },
  ]

  it('renders empty state when items list is empty', () => {
    const wrapper = mount(HistoryList, {
      props: { items: [], emptyHint: 'No history yet' },
      global: {
        stubs: {
          StateMessage: {
            props: ['title', 'message', 'icon'],
            template:
              '<div class="ui-state-stub"><span class="title">{{ title }}</span><span class="msg">{{ message }}</span></div>',
          },
          Button: true,
          IconButton: true,
          Icon: true,
        },
      },
    })

    expect(wrapper.find('.ui-state-stub').exists()).toBe(true)
    expect(wrapper.find('.ui-state-stub .title').text()).toBe('history.empty')
    expect(wrapper.find('.ui-state-stub .msg').text()).toBe('No history yet')
  })

  it('renders grouped items and displays text', () => {
    const wrapper = mount(HistoryList, {
      props: { items: sampleItems },
      global: {
        stubs: {
          StateMessage: true,
          Button: true,
          IconButton: true,
          Icon: true,
        },
      },
    })

    const items = wrapper.findAll('.history-item')
    expect(items).toHaveLength(2)
    expect(items[0].text()).toContain('First item short text')
  })

  it('filters items by searchQuery', async () => {
    const wrapper = mount(HistoryList, {
      props: { items: sampleItems, searchQuery: 'Second' },
      global: {
        stubs: {
          StateMessage: true,
          Button: true,
          IconButton: true,
          Icon: true,
        },
      },
    })

    const items = wrapper.findAll('.history-item')
    expect(items).toHaveLength(1)
    expect(items[0].attributes('data-history-id')).toBe('2')
  })

  it('shows nothing found state when query matches nothing', () => {
    const wrapper = mount(HistoryList, {
      props: { items: sampleItems, searchQuery: 'non-existent-match' },
      global: {
        stubs: {
          StateMessage: {
            props: ['title'],
            template: '<div class="ui-state-stub">{{ title }}</div>',
          },
          Button: true,
          IconButton: true,
          Icon: true,
        },
      },
    })

    expect(wrapper.find('.ui-state-stub').text()).toBe('history.nothingFound')
  })

  it('handles clear confirmation workflow', async () => {
    const wrapper = mount(HistoryList, {
      props: { items: sampleItems, totalCount: 2 },
      global: {
        stubs: {
          Button: { props: ['variant'], template: '<button><slot /></button>' },
          ConfirmModal: {
            props: ['open', 'title', 'message'],
            template:
              '<div v-if="open" class="confirm-modal-stub"><button class="confirm-clear-btn" @click="$emit(\'confirm\')">Confirm</button></div>',
          },
          IconButton: true,
          StateMessage: true,
          Icon: true,
        },
      },
    })

    // Click clear button
    const clearBtn = wrapper.find('.clear-btn')
    expect(clearBtn.exists()).toBe(true)
    await clearBtn.trigger('click')

    // Confirm button should appear
    const confirmBtn = wrapper.find('.confirm-clear-btn')
    expect(confirmBtn.exists()).toBe(true)

    await confirmBtn.trigger('click')
    expect(wrapper.emitted('clear')).toHaveLength(1)
  })

  it('toggles expand for long items', async () => {
    const wrapper = mount(HistoryList, {
      props: { items: sampleItems },
      global: {
        stubs: {
          Button: true,
          IconButton: true,
          StateMessage: true,
          Icon: true,
        },
      },
    })

    const longItem = wrapper.find('[data-history-id="2"]')
    const toggleBtn = longItem.find('.history-expand-toggle')
    expect(toggleBtn.exists()).toBe(true)
    expect(toggleBtn.text()).toContain('history.expand')
    expect(toggleBtn.attributes('aria-expanded')).toBe('false')

    await toggleBtn.trigger('click')
    expect(longItem.find('.history-text-value').classes()).toContain('expanded')
    expect(toggleBtn.text()).toContain('history.collapse')
    expect(toggleBtn.attributes('aria-expanded')).toBe('true')
    expect(toggleBtn.attributes('aria-controls')).toBe(
      longItem.get('.history-text-value').attributes('id')
    )
  })

  it('emits action event when action button is clicked', async () => {
    const actions = [
      { id: 'copy', icon: 'mdi:content-copy', title: 'Copy' },
      { id: 'delete', icon: 'mdi:delete', title: 'Delete', danger: true },
    ]

    const wrapper = mount(HistoryList, {
      props: { items: sampleItems, actions },
      global: {
        stubs: {
          IconButton: {
            props: ['title', 'icon'],
            template:
              '<button class="icon-btn-stub" :title="title" @click="$emit(\'click\')"><slot /></button>',
          },
          Button: true,
          StateMessage: true,
          Icon: true,
        },
      },
    })

    const firstItem = wrapper.find('[data-history-id="1"]')
    const actionButtons = firstItem.findAll('.icon-btn-stub')
    expect(actionButtons.length).toBeGreaterThan(0)

    await actionButtons[0].trigger('click')
    expect(wrapper.emitted('action')?.[0]).toEqual(['copy', sampleItems[0]])
  })

  it('shows no empty state while the items are loading', () => {
    const wrapper = mount(HistoryList, {
      props: { items: [], isLoading: true, emptyHint: 'No history yet' },
    })

    expect(wrapper.text()).not.toContain('history.empty')
    expect(wrapper.find('[aria-busy="true"]').exists()).toBe(true)
  })

  describe('recording playback', () => {
    const recordingItem = (
      playback: Partial<
        NonNullable<NonNullable<HistoryListItem['file']>['playback']>
      > = {}
    ): HistoryListItem => ({
      id: 'dialog',
      value: 'Call',
      filesSection: {
        title: 'Recordings',
        action: {
          id: 'openRecordingsFolder',
          icon: 'mdi:folder-open-outline',
          title: 'Open folder',
        },
      },
      file: {
        name: 'call.opus',
        isMissing: false,
        missingLabel: 'missing',
        playback: {
          source: () => 'tyco-media://localhost/recording/call.opus',
          playTitle: 'Play',
          stopTitle: 'Stop',
          speedTitle: 'Playback speed',
          unavailableLabel: 'unplayable',
          ...playback,
        },
      },
    })
    const stubs = {
      IconButton: {
        props: ['label', 'disabled'],
        template:
          '<button class="icon-btn-stub" :aria-label="label" :disabled="disabled" />',
      },
      Button: {
        props: ['icon'],
        template: '<button class="btn-stub"><slot /></button>',
      },
      StateMessage: true,
    }
    const playButton = (wrapper: ReturnType<typeof mount>) =>
      wrapper
        .findAll('.icon-btn-stub')
        .find((button) =>
          ['Play', 'Stop', 'Busy'].includes(
            button.attributes('aria-label') ?? ''
          )
        )!

    it('renders the recordings section header with open folder action and inline player', async () => {
      const wrapper = mount(HistoryList, {
        props: { items: [recordingItem()] },
        global: { stubs },
      })
      expect(wrapper.find('.history-files-title').text()).toBe('Recordings')
      await wrapper.find('.history-files-header .btn-stub').trigger('click')
      expect(wrapper.emitted('action')?.[0]?.[0]).toBe('openRecordingsFolder')
      expect(wrapper.find('audio').exists()).toBe(false)

      await playButton(wrapper).trigger('click')
      expect(wrapper.get('audio').attributes('src')).toBe(
        'tyco-media://localhost/recording/call.opus'
      )
      expect(wrapper.find('.history-player-seek').exists()).toBe(true)
      const options = wrapper
        .findAll('.history-player-speed .option-label')
        .map((option) => option.text())
      expect(options).toEqual(['1×', '1.25×', '1.5×', '2×'])

      await wrapper.get('audio').trigger('error')
      expect(wrapper.text()).toContain('unplayable')

      await playButton(wrapper).trigger('click')
      expect(wrapper.find('audio').exists()).toBe(false)
    })

    it('seeks and changes playback speed in the inline player', async () => {
      const wrapper = mount(HistoryList, {
        props: { items: [recordingItem()] },
        global: { stubs },
      })
      await playButton(wrapper).trigger('click')
      const audio = wrapper.get('audio').element as HTMLAudioElement
      Object.defineProperty(audio, 'duration', {
        value: 20,
        configurable: true,
      })
      await wrapper.get('audio').trigger('loadedmetadata')

      const seek = wrapper.get('.history-player-seek')
      await seek.setValue('12.5')
      expect(audio.currentTime).toBe(12.5)

      const radio = wrapper.get('input[type="radio"][value="1.5"]')
      await radio.setValue()
      expect(audio.playbackRate).toBe(1.5)
    })

    it('offers no playback while a dialog runs and stops the player', async () => {
      const wrapper = mount(HistoryList, {
        props: { items: [recordingItem()] },
        global: { stubs },
      })
      await playButton(wrapper).trigger('click')
      await wrapper.setProps({
        items: [recordingItem({ disabledTitle: 'Busy' })],
      })
      expect(wrapper.find('audio').exists()).toBe(false)
      expect(playButton(wrapper).attributes('disabled')).toBeDefined()
    })

    it('switches playback between two recordings in the same item without showing a transient error', async () => {
      let resolveFirst!: (url: string) => void
      let resolveSecond!: (url: string) => void
      const item: HistoryListItem = {
        id: 'dialog',
        value: 'Call',
        files: [
          {
            name: 'first.opus',
            isMissing: false,
            missingLabel: 'missing',
            playback: {
              source: () =>
                new Promise<string>((resolve) => {
                  resolveFirst = resolve
                }),
              playTitle: 'Play',
              stopTitle: 'Stop',
              speedTitle: 'Playback speed',
              unavailableLabel: 'unplayable',
            },
          },
          {
            name: 'second.opus',
            isMissing: false,
            missingLabel: 'missing',
            playback: {
              source: () =>
                new Promise<string>((resolve) => {
                  resolveSecond = resolve
                }),
              playTitle: 'Play',
              stopTitle: 'Stop',
              speedTitle: 'Playback speed',
              unavailableLabel: 'unplayable',
            },
          },
        ],
      }
      const wrapper = mount(HistoryList, {
        props: { items: [item] },
        global: { stubs },
      })
      const rows = wrapper.findAll('.history-file')
      await rows[0].get('.icon-btn-stub').trigger('click')
      // While the async source is loading, no <audio> with empty src or error is mounted
      expect(wrapper.find('audio').exists()).toBe(false)
      expect(wrapper.text()).not.toContain('unplayable')

      resolveFirst('blob:first')
      await Promise.resolve()
      await wrapper.vm.$nextTick()
      const firstAudio = rows[0].get('audio')
      expect(firstAudio.attributes('src')).toBe('blob:first')

      // Clicking play on the second recording in the same entry must not be
      // cancelled by the first <audio>'s unmount pause event
      await rows[1].get('.icon-btn-stub').trigger('click')
      await firstAudio.trigger('pause')
      resolveSecond('blob:second')
      await Promise.resolve()
      await wrapper.vm.$nextTick()
      expect(rows[0].find('audio').exists()).toBe(false)
      expect(rows[1].get('audio').attributes('src')).toBe('blob:second')
    })

    it('pauses the other players when one starts', async () => {
      const wrapper = mount(HistoryList, {
        props: { items: [{ ...recordingItem(), id: 'a' }, recordingItem()] },
        global: { stubs },
      })
      for (const button of wrapper
        .findAll('.icon-btn-stub')
        .filter((item) => item.attributes('aria-label') === 'Play'))
        await button.trigger('click')
      const [first, second] = wrapper.findAll('audio')
      const pause = vi
        .spyOn(first.element as HTMLMediaElement, 'pause')
        .mockImplementation(() => {})
      const ownPause = vi
        .spyOn(second.element as HTMLMediaElement, 'pause')
        .mockImplementation(() => {})
      second.element.dispatchEvent(new Event('play'))
      expect(pause).toHaveBeenCalled()
      expect(ownPause).not.toHaveBeenCalled()
    })
  })
})
