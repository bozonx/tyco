import { flushPromises, mount } from '@vue/test-utils'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { nextTick, reactive } from 'vue'

import { APP_ROUTES } from '../lib/navigation/routes'
import VoiceView from './VoiceView.vue'

const desktopState = reactive({
  isWindowShown: true,
  mode: 'voice',
  activationId: 1,
  windowId: 123 as number | undefined,
})

const mocks = vi.hoisted(() => ({
  windowLabel: 'quick',
  insertAction: vi.fn(),
  copyAction: vi.fn(),
  navPanel: { resetNavPanelState: vi.fn() },
  menuModals: { hasOpenModal: false },
  callOrNotify: vi.fn(),
  navigationPush: vi.fn(),
  finishSignal: {
    mode: (): string | undefined => undefined,
    confirm: () => {},
  },
}))

vi.mock('../composables/use-voice-finish-signal', () => ({
  useVoiceFinishSignal: (mode: () => string | undefined, confirm: () => void) =>
    (mocks.finishSignal = { mode, confirm }),
}))

vi.mock('../lib/desktop/window', () => ({
  getDesktopWindow: () => ({ label: mocks.windowLabel }),
  isQuickWindow: () => mocks.windowLabel === 'quick',
}))

vi.mock('../navigation', () => ({
  appNavigation: { push: mocks.navigationPush },
}))

vi.mock('../components/common/ContentPadding.vue', () => ({
  default: { template: '<div class="content-padding-stub"><slot /></div>' },
}))

vi.mock('../components/menu/VoiceRecognitionMenu.vue', () => ({
  default: {
    name: 'VoiceRecognitionMenu',
    props: ['variant', 'finishBehavior', 'activationMode'],
    emits: ['corrected', 'cancelled'],
    template: '<div class="voice-menu-stub" :data-variant="variant" />',
  },
}))

vi.mock('../components/menu/InsertMenu.vue', () => ({
  default: {
    name: 'InsertMenu',
    props: ['text', 'oldText', 'allowInsertButton', 'shortcutsDisabled'],
    template:
      '<div class="insert-menu-stub" :data-text="text" :data-disabled="shortcutsDisabled" />',
  },
}))

vi.mock('../stores/window', () => ({
  useWindowStore: () => ({ hide: () => mocks.callOrNotify('hide_window') }),
}))
vi.mock('../stores/ipc', () => ({
  useIpcStore: () => ({ callOrNotify: mocks.callOrNotify }),
}))
vi.mock('../stores/desktop', async () => {
  const { mockDesktopStore } = await import('../test/desktop-store')
  return { useDesktopStore: () => mockDesktopStore(() => desktopState) }
})

vi.mock('../stores/nav-panel', () => ({
  useNavPanelStore: () => mocks.navPanel,
}))

vi.mock('../stores/menu-modals', () => ({
  useMenuModalsStore: () => mocks.menuModals,
}))

vi.mock('../stores/action-menu', () => ({
  useActionMenuStore: () => ({
    getDefaultActions: () => [
      { id: 'insertIntoWindow', action: mocks.insertAction },
      { id: 'copyToClipboard', action: mocks.copyAction },
    ],
  }),
}))

describe('VoiceView.vue', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.windowLabel = 'quick'
    desktopState.isWindowShown = true
    desktopState.mode = 'voice'
    desktopState.activationId = 1
    desktopState.windowId = 123
    mocks.menuModals.hasOpenModal = false
  })

  it('resets nav panel state on creation and renders voice recognition menu inside padding', () => {
    const wrapper = mount(VoiceView, { props: { bar: false } })

    expect(mocks.navPanel.resetNavPanelState).toHaveBeenCalledWith({
      panelVisible: false,
    })
    const voiceMenu = wrapper.findComponent({ name: 'VoiceRecognitionMenu' })
    expect(voiceMenu.exists()).toBe(true)
    expect(voiceMenu.props('finishBehavior')).toBe('insertIntoTarget')
    expect(voiceMenu.props('variant')).toBeUndefined()
    expect(wrapper.emitted('result-shown')?.[0]).toEqual([false])
  })

  it('renders within a bar layer when bar prop is true', () => {
    const wrapper = mount(VoiceView, { props: { bar: true } })

    expect(wrapper.find('.voice-bar-layer').exists()).toBe(true)
    const voiceMenu = wrapper.findComponent({ name: 'VoiceRecognitionMenu' })
    expect(voiceMenu.props('variant')).toBe('bar')
  })

  it('inserts into target window directly when canInsertIntoWindow is true and intent is not next', async () => {
    const wrapper = mount(VoiceView, { props: { bar: false } })
    const voiceMenu = wrapper.findComponent({ name: 'VoiceRecognitionMenu' })

    voiceMenu.vm.$emit(
      'corrected',
      'Dictated text',
      'Dictated text',
      undefined,
      'insert'
    )
    await flushPromises()

    expect(mocks.insertAction).toHaveBeenCalledWith('Dictated text')
    expect(wrapper.findComponent({ name: 'InsertMenu' }).exists()).toBe(false)
  })

  it('copies to clipboard directly when intent is copy', async () => {
    const wrapper = mount(VoiceView, { props: { bar: false } })
    const voiceMenu = wrapper.findComponent({ name: 'VoiceRecognitionMenu' })

    voiceMenu.vm.$emit(
      'corrected',
      'Dictated text',
      'Dictated text',
      undefined,
      'copy'
    )
    await flushPromises()

    expect(mocks.copyAction).toHaveBeenCalledWith('Dictated text')
    expect(wrapper.findComponent({ name: 'InsertMenu' }).exists()).toBe(false)
  })

  it('shows InsertMenu when canInsertIntoWindow is false', async () => {
    desktopState.windowId = undefined
    const wrapper = mount(VoiceView, { props: { bar: false } })
    const voiceMenu = wrapper.findComponent({ name: 'VoiceRecognitionMenu' })

    voiceMenu.vm.$emit(
      'corrected',
      'Review text',
      'Review text',
      undefined,
      'insert'
    )
    await flushPromises()

    expect(mocks.insertAction).not.toHaveBeenCalled()
    const insertMenu = wrapper.findComponent({ name: 'InsertMenu' })
    expect(insertMenu.exists()).toBe(true)
    expect(insertMenu.props('text')).toBe('Review text')
    expect(insertMenu.props('allowInsertButton')).toBe(true)
    expect(wrapper.emitted('result-shown')?.at(-1)).toEqual([true])
  })

  it('shows InsertMenu when intent is next even if canInsertIntoWindow is true', async () => {
    const wrapper = mount(VoiceView, { props: { bar: false } })
    const voiceMenu = wrapper.findComponent({ name: 'VoiceRecognitionMenu' })

    voiceMenu.vm.$emit(
      'corrected',
      'Styled result',
      'Raw transcript',
      'Styled result',
      'next'
    )
    await flushPromises()

    expect(mocks.insertAction).not.toHaveBeenCalled()
    const insertMenu = wrapper.findComponent({ name: 'InsertMenu' })
    expect(insertMenu.exists()).toBe(true)
    expect(insertMenu.props('text')).toBe('Styled result')
    expect(insertMenu.props('oldText')).toBe('Raw transcript')
  })

  it('starts a new dictation when its hotkey comes again in the actions step', async () => {
    const wrapper = mount(VoiceView, { props: { bar: true } })
    const voiceMenu = wrapper.findComponent({ name: 'VoiceRecognitionMenu' })
    expect(voiceMenu.props('activationMode')).toBe('voice')
    expect(mocks.finishSignal.mode()).toBeUndefined()

    voiceMenu.vm.$emit('corrected', 'Text', 'Text', undefined, 'next')
    await flushPromises()
    expect(mocks.finishSignal.mode()).toBe('voice')

    mocks.finishSignal.confirm()
    await flushPromises()
    expect(wrapper.findComponent({ name: 'InsertMenu' }).exists()).toBe(false)
    expect(
      wrapper.findComponent({ name: 'VoiceRecognitionMenu' }).exists()
    ).toBe(true)
  })

  it('leaves the hotkey to the quick window', () => {
    mocks.windowLabel = 'main'
    const wrapper = mount(VoiceView, { props: { bar: false } })
    expect(
      wrapper
        .findComponent({ name: 'VoiceRecognitionMenu' })
        .props('activationMode')
    ).toBeUndefined()
  })

  it('hides quick window on cancellation when window label is quick', async () => {
    mocks.windowLabel = 'quick'
    const wrapper = mount(VoiceView, { props: { bar: false } })
    const voiceMenu = wrapper.findComponent({ name: 'VoiceRecognitionMenu' })

    voiceMenu.vm.$emit('cancelled')
    await flushPromises()

    expect(mocks.callOrNotify).toHaveBeenCalledWith('hide_window')
    expect(mocks.navigationPush).not.toHaveBeenCalled()
  })

  it('navigates to editor on cancellation when window label is main', async () => {
    mocks.windowLabel = 'main'
    const wrapper = mount(VoiceView, { props: { bar: false } })
    const voiceMenu = wrapper.findComponent({ name: 'VoiceRecognitionMenu' })

    voiceMenu.vm.$emit('cancelled')
    await flushPromises()

    expect(mocks.navigationPush).toHaveBeenCalledWith(APP_ROUTES.EDITOR.path)
    expect(mocks.callOrNotify).not.toHaveBeenCalled()
  })

  it('ignores cancellation if window is hidden or mode is not voice', async () => {
    desktopState.isWindowShown = false
    const wrapper = mount(VoiceView, { props: { bar: false } })
    const voiceMenu = wrapper.findComponent({ name: 'VoiceRecognitionMenu' })

    voiceMenu.vm.$emit('cancelled')
    await flushPromises()

    expect(mocks.callOrNotify).not.toHaveBeenCalled()
    expect(mocks.navigationPush).not.toHaveBeenCalled()
  })

  it('clears insert menu and text when window hides or activationId changes', async () => {
    const wrapper = mount(VoiceView, { props: { bar: false } })
    const voiceMenu = wrapper.findComponent({ name: 'VoiceRecognitionMenu' })

    voiceMenu.vm.$emit('corrected', 'Text', 'Text', undefined, 'next')
    await flushPromises()
    expect(wrapper.findComponent({ name: 'InsertMenu' }).exists()).toBe(true)

    desktopState.activationId = 2
    await nextTick()
    await flushPromises()

    expect(wrapper.findComponent({ name: 'InsertMenu' }).exists()).toBe(false)
  })
})
