import { mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { nextTick, reactive } from 'vue'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { CommandConfig } from '@tyco/shared'

import { createCommandLauncherModel } from '../../lib/command-launcher/launcher-model'
import { createCommand } from '../../lib/commands/command-config'
import { testTools } from '../../lib/tools/testing'
import CommandLauncher from './CommandLauncher.vue'

const mocks = vi.hoisted(() => ({
  desktopState: { activationId: 1, selectedText: null as string | null },
  run: vi.fn(async () => ({ success: true, result: undefined })),
  handleEsc: vi.fn(),
  store: null as unknown,
}))

vi.mock('../../composables/use-i18n', () => ({
  useI18n: () => ({ t: (key: string) => key }),
}))
vi.mock('../../composables/use-overlay-nav', () => ({
  useOverlayNav: (options?: () => { onEsc?: () => void }) => ({
    escLabel: 'Esc',
    handleEsc: () => {
      const onEsc = options?.().onEsc
      if (onEsc) onEsc()
      else mocks.handleEsc()
    },
  }),
}))
vi.mock('../../stores/ipc', () => ({
  useIpcStore: () => ({ callFunctionOrNotify: vi.fn() }),
}))
vi.mock('../../stores/desktop', async () => {
  const { mockDesktopStore } = await import('../../test/desktop-store')
  return {
    useDesktopStore: () => mockDesktopStore(() => reactive(mocks.desktopState)),
  }
})
vi.mock('../../stores/tools', async () => {
  const { testTools } = await import('../../lib/tools/testing')
  const tools = testTools()
  return { useToolsStore: () => tools }
})
vi.mock('../../stores/command-launcher', () => ({
  useCommandLauncherStore: () => mocks.store,
}))

const webhook = (
  id: string,
  extra: Partial<CommandConfig> = {},
  takesText = false
): CommandConfig => {
  const base = createCommand('webhook', id)
  return {
    ...base,
    name: id,
    toolConfig: {
      ...base.toolConfig,
      url: takesText ? 'https://x.test/?q={{TEXT}}' : 'https://x.test',
    },
    ...extra,
  }
}

function mountLauncher(
  commands: CommandConfig[],
  launcherPages: (string | null)[][] = []
) {
  mocks.store = reactive(
    createCommandLauncherModel({
      launcherPages: () =>
        [[], ...launcherPages].map((slots, index) => ({
          id: `page-${index}`,
          slots,
          inputMode: 'selection',
        })),
      tools: testTools(),
      commands: () => commands,
      selectedText: () => mocks.desktopState.selectedText,
      run: mocks.run,
    })
  )
  return mount(CommandLauncher, {
    attachTo: document.body,
    global: { stubs: { InProgressMessage: true } },
  })
}

const keydown = (target: Element, init: KeyboardEventInit) =>
  target.dispatchEvent(
    new KeyboardEvent('keydown', { bubbles: true, cancelable: true, ...init })
  )

beforeEach(() => {
  setActivePinia(createPinia())
})

afterEach(() => {
  vi.clearAllMocks()
  mocks.desktopState.selectedText = null
})

describe('CommandLauncher', () => {
  it('selects pages with digits and cycles with PageUp/PageDown without running commands', async () => {
    const wrapper = mountLauncher([webhook('backup')], [['backup'], []])
    const press = (key: string, shiftKey = false) =>
      window.dispatchEvent(
        new KeyboardEvent('keydown', {
          key,
          code: key.startsWith('Page') ? key : `Digit${key}`,
          shiftKey,
          cancelable: true,
        })
      )
    expect(wrapper.find('.launcher-pages-label').text()).toBe(
      'commandLauncher.pages'
    )
    const pageButtons = wrapper.findAll('.launcher-pages button')
    expect(pageButtons).toHaveLength(3)
    expect(pageButtons.map((b) => b.text())).toEqual(['1', '2', '3'])
    expect(pageButtons[0].attributes('aria-pressed')).toBe('true')
    expect(pageButtons[1].attributes('aria-pressed')).toBe('false')

    await pageButtons[1].trigger('click')
    expect((mocks.store as { pageIndex: number }).pageIndex).toBe(1)

    for (const shiftKey of [false, true]) {
      expect(press('Tab', shiftKey)).toBe(true)
      expect((mocks.store as { pageIndex: number }).pageIndex).toBe(1)
    }
    press('2')
    expect((mocks.store as { pageIndex: number }).pageIndex).toBe(1)
    press('PageDown')
    expect((mocks.store as { pageIndex: number }).pageIndex).toBe(2)
    press('PageDown')
    expect((mocks.store as { pageIndex: number }).pageIndex).toBe(0)
    press('PageUp')
    expect((mocks.store as { pageIndex: number }).pageIndex).toBe(2)
    expect(mocks.run).not.toHaveBeenCalled()
    wrapper.unmount()
  })

  it('runs a command with its slot key in the 5x3 grid', async () => {
    const backup = webhook('backup')
    const lights = webhook('lights')
    const wrapper = mountLauncher([backup, lights])

    // Key 'w' is the second key in SHORTCUT_SLOT_KEYS ('q', 'w', 'e'...)
    window.dispatchEvent(
      new KeyboardEvent('keydown', { code: 'KeyW', bubbles: true })
    )
    window.dispatchEvent(
      new KeyboardEvent('keyup', { code: 'KeyW', bubbles: true })
    )
    await nextTick()

    expect(mocks.run).toHaveBeenCalledWith(lights, '', expect.anything())
    wrapper.unmount()
  })

  it('opens search mode with Space or Enter and runs a searched command', async () => {
    const backup = webhook('backup')
    const wrapper = mountLauncher([backup])

    expect(wrapper.find('input').exists()).toBe(false)

    // Space opens search mode
    window.dispatchEvent(
      new KeyboardEvent('keydown', { code: 'Space', bubbles: true })
    )
    window.dispatchEvent(
      new KeyboardEvent('keyup', { code: 'Space', bubbles: true })
    )
    await nextTick()

    const input = wrapper.find('input')
    expect(input.exists()).toBe(true)

    // Press enter on the input to run the highlighted match
    keydown(input.element, { key: 'Enter', code: 'Enter' })
    await nextTick()

    expect(mocks.run).toHaveBeenCalledWith(backup, '', expect.anything())
    wrapper.unmount()
  })

  it('asks for the text when nothing is selected', async () => {
    const note = webhook('note', {}, true)
    const wrapper = mountLauncher([note])

    // Press Q to select the first command
    window.dispatchEvent(
      new KeyboardEvent('keydown', { code: 'KeyQ', bubbles: true })
    )
    window.dispatchEvent(
      new KeyboardEvent('keyup', { code: 'KeyQ', bubbles: true })
    )
    await nextTick()

    const textarea = wrapper.find('textarea')
    expect(textarea.exists()).toBe(true)

    await textarea.setValue('buy milk')
    keydown(textarea.element, { key: 'Enter', code: 'Enter' })
    await nextTick()
    expect(mocks.run).toHaveBeenCalledWith(note, 'buy milk', expect.anything())
    wrapper.unmount()
  })

  it('goes back from search with Esc and closes from grid with Esc', async () => {
    const wrapper = mountLauncher([webhook('note')])

    // Open search
    window.dispatchEvent(
      new KeyboardEvent('keydown', { code: 'Space', bubbles: true })
    )
    window.dispatchEvent(
      new KeyboardEvent('keyup', { code: 'Space', bubbles: true })
    )
    await nextTick()
    expect(wrapper.find('input').exists()).toBe(true)

    // Esc from search mode returns to grid
    keydown(document.body, { key: 'Escape', code: 'Escape' })
    window.dispatchEvent(
      new KeyboardEvent('keyup', { key: 'Escape', code: 'Escape' })
    )
    await nextTick()

    expect(wrapper.find('input').exists()).toBe(false)
    expect(mocks.handleEsc).not.toHaveBeenCalled()

    // Esc from grid closes the launcher
    keydown(document.body, { key: 'Escape', code: 'Escape' })
    window.dispatchEvent(
      new KeyboardEvent('keyup', { key: 'Escape', code: 'Escape' })
    )
    await nextTick()

    expect(mocks.handleEsc).toHaveBeenCalled()
    wrapper.unmount()
  })

  it('ignores the release of an Esc pressed before it opened', async () => {
    const wrapper = mountLauncher([webhook('backup')])
    window.dispatchEvent(
      new KeyboardEvent('keyup', { key: 'Escape', code: 'Escape' })
    )
    expect(mocks.handleEsc).not.toHaveBeenCalled()
    wrapper.unmount()
  })
})
