import { flushPromises, mount } from '@vue/test-utils'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { reactive } from 'vue'
import { createCommand } from '../lib/commands/command-config'
import { i18n } from '../lib/i18n'
import VoiceCommandsView from './VoiceCommandsView.vue'

const mocks = vi.hoisted(() => ({
  start: vi.fn(),
  finish: vi.fn(),
  cancel: vi.fn(),
  run: vi.fn(),
  chooseCommand: vi.fn(),
  choose: vi.fn(),
  editTranscript: vi.fn(),
  hide: vi.fn(),
  release: vi.fn(),
  listen: vi.fn().mockResolvedValue(() => {}),
}))
const state = reactive({ isWindowShown: true, activationId: 12 })
const commands = Array.from({ length: 40 }, (_, index) => ({
  ...createCommand('script', `command-${index}`),
  name: `Command ${index}`,
  description: `Description ${index}`,
  phrases: [`save note ${index}`],
}))
const voice = reactive({
  ...mocks,
  stage: 'recording',
  transcript: '',
  inputText: '',
  selected: undefined,
  error: '',
  resolution: { kind: 'none', candidates: [] },
  command: undefined,
  canRun: false,
  inputIssue: undefined,
  catalog: commands,
  unavailableReason: () => undefined,
  catalogRoutes: commands.map((command) => ({
    commandId: command.id,
    phrase: command.phrases[0],
    parameters: [],
  })),
})
vi.mock('../stores/voice-commands', () => ({
  useVoiceCommandsStore: () => voice,
}))
vi.mock('../stores/ipc', () => ({
  useIpcStore: () => ({ desktopState: state }),
}))
vi.mock('../stores/quick-dismiss', () => ({
  useQuickDismissStore: () => ({ hold: () => mocks.release }),
}))
vi.mock('../lib/desktop/client', () => ({
  desktopClient: { listen: mocks.listen },
}))
vi.mock('../composables/use-overlay-nav', () => ({
  useOverlayNav: () => ({ handleEsc: mocks.hide }),
}))
vi.mock('../components/common/ActionOverlayLayout.vue', () => ({
  default: { template: '<div><slot /></div>' },
}))

describe('separate voice command overlay', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    state.isWindowShown = true
    voice.stage = 'recording'
  })
  it('shows the full catalog with phrases and descriptions and starts recording', () => {
    const wrapper = mount(VoiceCommandsView, { global: { plugins: [i18n] } })
    expect(wrapper.findAll('.voice-catalog article')).toHaveLength(40)
    expect(wrapper.find('.voice-catalog').attributes('tabindex')).toBe('0')
    expect(wrapper.text()).toContain('save note 39')
    expect(wrapper.text()).toContain('Description 39')
    expect(mocks.start).toHaveBeenCalledOnce()
    expect(mocks.run).not.toHaveBeenCalled()
    wrapper.unmount()
    expect(mocks.cancel).toHaveBeenCalled()
    expect(mocks.release).toHaveBeenCalledOnce()
  })
  it('finishes only the current activation on a repeat hotkey and cancels on hiding', async () => {
    const wrapper = mount(VoiceCommandsView, { global: { plugins: [i18n] } })
    await flushPromises()
    const handler = mocks.listen.mock.calls[0]![1] as (id: number) => void
    handler(11)
    expect(mocks.finish).not.toHaveBeenCalled()
    handler(12)
    expect(mocks.finish).toHaveBeenCalledOnce()
    state.isWindowShown = false
    await flushPromises()
    expect(mocks.cancel).toHaveBeenCalled()
    wrapper.unmount()
  })
  it('offers manual selection only after recording is finished', async () => {
    const wrapper = mount(VoiceCommandsView, { global: { plugins: [i18n] } })
    const button = wrapper.find('.voice-catalog article button')
    expect(button.attributes('disabled')).toBeDefined()
    voice.stage = 'review'
    await flushPromises()
    await button.trigger('click')
    expect(mocks.chooseCommand).toHaveBeenCalledWith('command-0')
    wrapper.unmount()
  })
})
