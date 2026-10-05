import { mount } from '@vue/test-utils'
import { nextTick, reactive } from 'vue'
import { afterEach, describe, expect, it, vi } from 'vitest'

import type { CommandConfig } from '@tyco/shared'

import { createCommandLauncherModel } from '../../lib/command-launcher/launcher-model'
import { createCommand } from '../../lib/commands/command-config'
import { testTools } from '../../lib/tools/testing'
import CommandLauncher from './CommandLauncher.vue'

const mocks = vi.hoisted(() => ({
  params: { activationId: 1, selectedText: null as string | null },
  run: vi.fn(async () => ({ success: true })),
  handleEsc: vi.fn(),
  store: null as unknown,
}))

vi.mock('../../composables/useI18n', () => ({
  useI18n: () => ({ t: (key: string) => key }),
}))
vi.mock('../../composables/useOverlayNav', () => ({
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
  useIpcStore: () => ({
    params: reactive(mocks.params),
    callFunctionOrNotify: vi.fn(),
  }),
}))
vi.mock('../../stores/tools', async () => {
  const { testTools } = await import('../../lib/tools/testing')
  const tools = testTools()
  return { useToolsStore: () => tools }
})
vi.mock('../../stores/commandLauncher', () => ({
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
    confirm: 'auto',
    toolConfig: { ...base.toolConfig, url: 'https://x.test', takesText },
    ...extra,
  }
}

function mountLauncher(commands: CommandConfig[]) {
  mocks.store = reactive(
    createCommandLauncherModel({
      tools: testTools(),
      commands: () => commands,
      selectedText: () => mocks.params.selectedText,
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

afterEach(() => {
  vi.clearAllMocks()
  mocks.params.selectedText = null
})

describe('CommandLauncher', () => {
  it('runs a command with its digit key', async () => {
    const backup = webhook('backup')
    const lights = webhook('lights')
    const wrapper = mountLauncher([backup, lights])
    const input = wrapper.find('input').element

    keydown(input, { key: '2', code: 'Digit2' })
    await nextTick()

    expect(mocks.run).toHaveBeenCalledWith(lights, '', expect.anything())
    wrapper.unmount()
  })

  it('types a digit into the search once there is a query', async () => {
    const wrapper = mountLauncher([webhook('backup')])
    await wrapper.find('input').setValue('b')

    const event = new KeyboardEvent('keydown', {
      key: '1',
      code: 'Digit1',
      bubbles: true,
      cancelable: true,
    })
    wrapper.find('input').element.dispatchEvent(event)

    expect(event.defaultPrevented).toBe(false)
    expect(mocks.run).not.toHaveBeenCalled()
    wrapper.unmount()
  })

  it('waits for another Enter to run a command that asks to confirm', async () => {
    const backup = webhook('backup', { confirm: 'always' })
    const wrapper = mountLauncher([backup])

    keydown(wrapper.find('input').element, { key: 'Enter', code: 'Enter' })
    await nextTick()
    expect(mocks.run).not.toHaveBeenCalled()
    expect(wrapper.text()).toContain('commandLauncher.confirmRun')

    keydown(document.body, { key: 'Enter', code: 'Enter' })
    await nextTick()
    expect(mocks.run).toHaveBeenCalledWith(backup, '', expect.anything())
    wrapper.unmount()
  })

  it('asks for the text when nothing is selected', async () => {
    const note = webhook('note', {}, true)
    const wrapper = mountLauncher([note])

    keydown(wrapper.find('input').element, { key: 'Enter', code: 'Enter' })
    await nextTick()
    const textarea = wrapper.find('textarea')
    expect(textarea.exists()).toBe(true)

    await textarea.setValue('buy milk')
    keydown(textarea.element, { key: 'Enter', code: 'Enter' })
    await nextTick()
    expect(mocks.run).toHaveBeenCalledWith(note, 'buy milk', expect.anything())
    wrapper.unmount()
  })

  it('goes back to the list with Esc and closes from the list', async () => {
    const wrapper = mountLauncher([webhook('note', {}, true)])
    keydown(wrapper.find('input').element, { key: 'Enter', code: 'Enter' })
    await nextTick()

    keydown(document.body, { key: 'Escape', code: 'Escape' })
    window.dispatchEvent(
      new KeyboardEvent('keyup', { key: 'Escape', code: 'Escape' })
    )
    await nextTick()
    expect(wrapper.find('textarea').exists()).toBe(false)
    expect(mocks.handleEsc).not.toHaveBeenCalled()

    keydown(document.body, { key: 'Escape', code: 'Escape' })
    window.dispatchEvent(
      new KeyboardEvent('keyup', { key: 'Escape', code: 'Escape' })
    )
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
