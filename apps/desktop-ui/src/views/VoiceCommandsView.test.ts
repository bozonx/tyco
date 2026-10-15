import { flushPromises, mount } from '@vue/test-utils'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { reactive } from 'vue'
import { createCommand } from '../lib/commands/command-config'
import { createBuiltInVoiceCommands } from '../lib/voice-commands/built-in-voice-commands'
import { testTools } from '../lib/tools/testing'
import { translate } from '../lib/i18n'
import { i18n } from '../lib/i18n'
import VoiceCommandsView from './VoiceCommandsView.vue'
import type { VoiceResolution } from '../lib/voice-commands/voice-resolver'

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
  resolution: { kind: 'none', candidates: [] } as VoiceResolution,
  command: undefined,
  canRun: false,
  inputIssue: undefined,
  catalog: commands,
  customCatalog: commands,
  builtInCatalog: createBuiltInVoiceCommands(testTools(), translate),
  unavailableReason: vi.fn<() => string | undefined>(() => undefined),
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
    voice.unavailableReason.mockReturnValue(undefined)
    state.isWindowShown = true
    voice.stage = 'recording'
    voice.resolution = { kind: 'none', candidates: [] }
    voice.customCatalog = commands
  })
  it('shows the full catalog with phrases and descriptions and starts recording', () => {
    const wrapper = mount(VoiceCommandsView, { global: { plugins: [i18n] } })
    expect(wrapper.findAll('.voice-custom-command')).toHaveLength(40)
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
    const button = wrapper.find('.voice-custom-command button')
    expect(button.attributes('disabled')).toBeDefined()
    voice.stage = 'review'
    await flushPromises()
    await button.trigger('click')
    expect(mocks.chooseCommand).toHaveBeenCalledWith('command-0')
    wrapper.unmount()
  })
  it('offers explicit parameter recovery without running or discarding unknown input', async () => {
    const candidate = {
      commandId: commands[0]!.id,
      text: 'Klingon Hello!',
      parameters: { language: 'en_US' },
      consumedWordCount: 2,
      textOffset: 13,
    }
    voice.stage = 'review'
    voice.resolution = {
      kind: 'parameter-error',
      candidates: [],
      parameterChoices: [candidate],
    }
    const wrapper = mount(VoiceCommandsView, { global: { plugins: [i18n] } })
    expect(wrapper.text()).toContain('en_US')
    const button = wrapper
      .findAll('.voice-input button')
      .find((item) => item.text().includes('en_US'))!
    await button.trigger('click')
    expect(mocks.choose).toHaveBeenCalledWith(candidate)
    expect(mocks.run).not.toHaveBeenCalled()
    wrapper.unmount()
  })
  it('always shows the two standard functions even when no user commands are enabled', () => {
    voice.customCatalog = []
    const wrapper = mount(VoiceCommandsView, { global: { plugins: [i18n] } })
    expect(wrapper.findAll('.voice-built-in')).toHaveLength(2)
    expect(wrapper.text()).toContain(translate('tools.askInChat'))
    expect(wrapper.text()).toContain(translate('tools.translate'))
    expect(wrapper.text()).toContain(translate('voiceCommands.builtInHint'))
    expect(wrapper.text()).toContain(translate('voiceCommands.empty'))
    expect(
      wrapper.findAll('.voice-built-in input[type="checkbox"]')
    ).toHaveLength(0)
    wrapper.unmount()
  })
  it('selects a standard translation language for manual review', async () => {
    voice.stage = 'review'
    const wrapper = mount(VoiceCommandsView, { global: { plugins: [i18n] } })
    await wrapper
      .find('.voice-language select')
      .setValue('builtin:voice:translate:es_AR')
    await wrapper.findAll('.voice-built-in')[1]!.find('button').trigger('click')
    expect(mocks.chooseCommand).toHaveBeenCalledWith(
      'builtin:voice:translate:es_AR'
    )
    expect(mocks.run).not.toHaveBeenCalled()
    wrapper.unmount()
  })
  it('shows why standard functions are unavailable and prevents manual execution', () => {
    voice.unavailableReason.mockReturnValue('tools.noTranslator')
    voice.stage = 'review'
    const wrapper = mount(VoiceCommandsView, { global: { plugins: [i18n] } })
    expect(wrapper.findAll('.voice-built-in')).toHaveLength(2)
    for (const article of wrapper.findAll('.voice-built-in')) {
      expect(article.find('[role="status"]').text()).toBe(
        translate('tools.noTranslator')
      )
      expect(article.find('button').attributes('disabled')).toBeDefined()
    }
    wrapper.unmount()
  })
})
