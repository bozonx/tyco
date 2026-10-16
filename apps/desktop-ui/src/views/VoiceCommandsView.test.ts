import { flushPromises, mount } from '@vue/test-utils'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { reactive } from 'vue'
import { createCommand } from '../lib/commands/command-config'
import { createBuiltInVoiceCommands } from '../lib/voice-commands/built-in-voice-commands'
import { testTools } from '../lib/tools/testing'
import { translate } from '../lib/i18n'
import { i18n } from '../lib/i18n'
import { getLanguageLabelKey } from '../lib/locale/language'
import VoiceCommandsView from './VoiceCommandsView.vue'
import type {
  VoiceCandidate,
  VoiceResolution,
} from '../lib/voice-commands/voice-resolver'
import type { CommandConfig } from '@tyco/shared'
import { DESKTOP_EVENTS } from '@tyco/shared'

const mocks = vi.hoisted(() => ({
  start: vi.fn(),
  finish: vi.fn(),
  cancel: vi.fn(),
  run: vi.fn(),
  chooseCommand: vi.fn(),
  choose: vi.fn(),
  switchCommand: vi.fn(),
  hide: vi.fn(),
  release: vi.fn(),
  listen: vi.fn().mockResolvedValue(() => {}),
}))
const state = reactive({ isWindowShown: true, activationId: 12 })
const builtInCommands = createBuiltInVoiceCommands(testTools(), translate)
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
  liveTranscript: { committed: '', draft: '' },
  inputText: '',
  selected: undefined as VoiceCandidate | undefined,
  error: '',
  resolution: { kind: 'none', candidates: [] } as VoiceResolution,
  command: undefined as CommandConfig | undefined,
  canRun: false,
  inputIssue: undefined,
  catalog: [...builtInCommands, ...commands] as CommandConfig[],
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
vi.mock('../stores/tools', () => ({ useToolsStore: () => testTools() }))
vi.mock('../components/common/ActionOverlayLayout.vue', () => ({
  default: {
    template:
      '<div><slot name="header-extra" /><slot name="preview" /><slot name="actions" /></div>',
  },
}))

const candidate = (commandId: string, text = 'Hello') => ({
  commandId,
  text,
  parameters: {},
  consumedWordCount: 1,
  textOffset: 0,
})
const mountView = () =>
  mount(VoiceCommandsView, {
    global: { plugins: [i18n] },
    attachTo: document.body,
  })
const entry = (wrapper: ReturnType<typeof mountView>, key: string) =>
  wrapper.find(`.voice-entry[data-key="${key}"]`)
const TRANSLATE_KEY = 'builtin:core.translate'

describe('separate voice command overlay', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    Element.prototype.scrollIntoView = vi.fn()
    voice.unavailableReason.mockReturnValue(undefined)
    state.isWindowShown = true
    voice.stage = 'recording'
    voice.selected = undefined
    voice.command = undefined
    voice.error = ''
    voice.inputText = ''
    voice.resolution = { kind: 'none', candidates: [] }
    voice.catalog = [...builtInCommands, ...commands]
  })
  it('lists the standard functions and user commands in one feed and starts recording', () => {
    const wrapper = mountView()
    const groups = wrapper.findAll('.voice-group').map((item) => item.text())
    expect(groups).toEqual([
      translate('voiceCommands.builtInCatalog'),
      translate('voiceCommands.customCatalog'),
    ])
    // one row for the chat, one for every translation language, 40 custom
    expect(wrapper.findAll('.voice-entry')).toHaveLength(42)
    expect(wrapper.text()).toContain('save note 39')
    expect(entry(wrapper, 'command-39').attributes('title')).toBe(
      'Description 39'
    )
    expect(wrapper.find('input[type="checkbox"]').exists()).toBe(false)
    expect(mocks.start).toHaveBeenCalledOnce()
    expect(mocks.run).not.toHaveBeenCalled()
    wrapper.unmount()
    expect(mocks.cancel).toHaveBeenCalled()
    expect(mocks.release).toHaveBeenCalledOnce()
  })
  it('finishes only the current activation on a repeat hotkey and cancels on hiding', async () => {
    const wrapper = mountView()
    await flushPromises()
    const call = mocks.listen.mock.calls.find(
      ([event]) => event === DESKTOP_EVENTS.VOICE_COMMAND_FINISH
    )!
    const handler = call[1] as (id: number) => void
    handler(11)
    expect(mocks.finish).not.toHaveBeenCalled()
    handler(12)
    expect(mocks.finish).toHaveBeenCalledOnce()
    state.isWindowShown = false
    await flushPromises()
    expect(mocks.cancel).toHaveBeenCalled()
    wrapper.unmount()
  })
  it('finishes to run on Space and for review on Tab', async () => {
    const wrapper = mountView()
    window.dispatchEvent(new KeyboardEvent('keydown', { code: 'Space' }))
    expect(mocks.finish).toHaveBeenLastCalledWith('run')
    window.dispatchEvent(new KeyboardEvent('keydown', { code: 'Tab' }))
    expect(mocks.finish).toHaveBeenLastCalledWith('review')
    wrapper.unmount()
  })
  it('marks the live match in the list instead of repeating it', async () => {
    const wrapper = mountView()
    voice.resolution = { kind: 'match', candidates: [candidate('command-30')] }
    await flushPromises()
    const row = entry(wrapper, 'command-30')
    expect(row.classes()).toContain('is-marked')
    expect(row.attributes('aria-current')).toBe('true')
    expect(Element.prototype.scrollIntoView).toHaveBeenCalled()
    expect(wrapper.findAll('.voice-entry.is-marked')).toHaveLength(1)
    wrapper.unmount()
  })
  it('lets the user pick a command only after recording is finished', async () => {
    const wrapper = mountView()
    await entry(wrapper, 'command-0').trigger('click')
    expect(mocks.chooseCommand).not.toHaveBeenCalled()
    voice.stage = 'review'
    await flushPromises()
    await entry(wrapper, 'command-0').trigger('click')
    expect(mocks.chooseCommand).toHaveBeenCalledWith('command-0')
    wrapper.unmount()
  })
  it('picks an ambiguous candidate with its recognized text', async () => {
    const first = candidate('command-1', 'Stripped')
    voice.stage = 'review'
    voice.resolution = {
      kind: 'ambiguous',
      candidates: [first, candidate('command-2')],
    }
    const wrapper = mountView()
    expect(wrapper.findAll('.voice-entry.is-marked')).toHaveLength(2)
    expect(wrapper.text()).toContain(translate('voiceCommands.ambiguous'))
    await entry(wrapper, 'command-1').trigger('click')
    expect(mocks.choose).toHaveBeenCalledWith(first)
    expect(mocks.run).not.toHaveBeenCalled()
    wrapper.unmount()
  })
  it('recovers an unrecognized language through the translation row', async () => {
    const choice = {
      ...candidate('builtin:voice:translate:es_AR', 'Klingon Hello!'),
      parameters: { language: 'es_AR' },
    }
    voice.stage = 'review'
    voice.resolution = {
      kind: 'parameter-error',
      candidates: [],
      parameterChoices: [choice],
    }
    const wrapper = mountView()
    expect(wrapper.text()).toContain(translate('voiceCommands.languageMissing'))
    await entry(wrapper, TRANSLATE_KEY).trigger('click')
    expect(mocks.choose).toHaveBeenCalledWith(choice)
    expect(mocks.run).not.toHaveBeenCalled()
    wrapper.unmount()
  })
  it('switches the translation language of the chosen command', async () => {
    const chosen = builtInCommands.find(
      (item) => item.id === 'builtin:voice:translate:en_US'
    )!
    voice.stage = 'review'
    voice.selected = candidate(chosen.id)
    voice.command = chosen
    const wrapper = mountView()
    expect(entry(wrapper, TRANSLATE_KEY).text()).toContain(
      translate(getLanguageLabelKey('en_US'))
    )
    const select = wrapper.find<HTMLSelectElement>('.voice-language')
    const index = [...select.element.options].findIndex(
      (option) => option.text === translate(getLanguageLabelKey('es_AR'))
    )
    await select.setValue(String(index))
    expect(mocks.switchCommand).toHaveBeenCalledWith(
      'builtin:voice:translate:es_AR'
    )
    expect(mocks.run).not.toHaveBeenCalled()
    wrapper.unmount()
  })
  it('runs the reviewed command on Enter and keeps Shift+Enter for new lines', async () => {
    voice.stage = 'review'
    const wrapper = mountView()
    window.dispatchEvent(
      new KeyboardEvent('keydown', { code: 'Enter', shiftKey: true })
    )
    expect(mocks.run).not.toHaveBeenCalled()
    window.dispatchEvent(new KeyboardEvent('keydown', { code: 'Enter' }))
    expect(mocks.run).toHaveBeenCalledOnce()
    window.dispatchEvent(
      new KeyboardEvent('keydown', { code: 'KeyR', ctrlKey: true })
    )
    expect(mocks.start).toHaveBeenCalledTimes(2)
    wrapper.unmount()
  })
  it('shows a short hint when no user commands are enabled', () => {
    voice.catalog = builtInCommands
    const wrapper = mountView()
    expect(wrapper.text()).toContain(translate('tools.askInChat'))
    expect(wrapper.text()).toContain(translate('tools.translate'))
    expect(wrapper.text()).toContain(translate('voiceCommands.empty'))
    wrapper.unmount()
  })
  it('explains unavailable functions and does not let them be picked', async () => {
    voice.unavailableReason.mockReturnValue('tools.noTranslator')
    voice.stage = 'review'
    const wrapper = mountView()
    const row = entry(wrapper, TRANSLATE_KEY)
    expect(row.attributes('aria-disabled')).toBe('true')
    expect(row.find('.voice-entry-warning').attributes('title')).toBe(
      translate('tools.noTranslator')
    )
    await row.trigger('click')
    expect(mocks.choose).not.toHaveBeenCalled()
    expect(mocks.chooseCommand).not.toHaveBeenCalled()
    wrapper.unmount()
  })
})
