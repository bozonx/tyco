import { mount } from '@vue/test-utils'
import { describe, expect, it, vi } from 'vitest'

import { createCommand } from '../../lib/commands/command-config'
import SettingsCommandsTab from './SettingsCommandsTab.vue'
import type { CommandConfig, UserConfig } from '@tyco/shared'

vi.mock('../../composables/use-i18n', () => ({
  useI18n: () => ({
    t: (key: string, params?: Record<string, unknown>) =>
      params ? `${key} ${JSON.stringify(params)}` : key,
  }),
}))

const removeSecret = vi.fn().mockResolvedValue(undefined)
const toastKey = vi.fn()

vi.mock('../../composables/use-toast', () => ({
  default: () => ({ toastKey }),
}))

vi.mock('../../stores/settings-session', () => ({
  useSettingsSessionStore: () => ({
    persist: vi.fn().mockResolvedValue(undefined),
    isSaved: () => true,
  }),
}))

vi.mock('../../stores/llm', () => ({ useLlmStore: () => ({ removeSecret }) }))
vi.mock('../../stores/tools', async () => {
  const { testTools } = await import('../../lib/tools/testing')
  const tools = testTools()
  return { useToolsStore: () => tools }
})

const webhook = {
  ...createCommand('webhook', 'wh1'),
  name: 'Hook',
  toolConfig: {
    url: 'https://x.test',
    isAuthEnabled: true,
    authSecretId: 'webhook-auth-wh1',
  },
}
const script = { ...createCommand('script', 'sc1'), name: 'Backup' }

const mountTab = (focusCommandId?: string) =>
  mount(SettingsCommandsTab, {
    props: {
      userConfig: {
        launcherPages: [],
        commands: [webhook, script],
        mainActions: [
          { type: 'command', commandId: 'wh1' },
          { type: 'standard', actionId: 'translation' },
        ],
      } as unknown as UserConfig,
      focusCommandId,
    },
    global: { stubs: { CommandEditor: true } },
  })

/** Picks an item of the menu of the card, e.g. the danger one: delete */
async function pickMenuItem(
  wrapper: ReturnType<typeof mountTab>,
  card: number,
  selector: string
) {
  const header = wrapper.findAll('.command-header')[card]
  await header.find('.dropdown-trigger').trigger('click')
  await header.find(selector).trigger('click')
}

describe('SettingsCommandsTab.vue', () => {
  it('preserves the moved command controls and blocks boundary moves', async () => {
    const wrapper = mountTab()
    const first = wrapper.findAll('.command-card')[0]
    const up = first.get('[aria-label^="common.moveUp"]')
    const down = first.get('[aria-label^="common.moveDown"]')
    await up.trigger('click')
    expect(wrapper.emitted('update:commands')).toBeUndefined()
    await down.trigger('click')
    const next = wrapper
      .emitted('update:commands')!
      .at(-1)![0] as CommandConfig[]
    expect(next.map((command) => command.id)).toEqual(['sc1', 'wh1'])
    await wrapper.setProps({
      userConfig: { ...wrapper.props('userConfig'), commands: next },
    })
    expect(
      wrapper.findAll('.command-card')[1].get('[aria-label^="common.moveDown"]')
        .element
    ).toBe(down.element)
    expect(down.attributes('aria-disabled')).toBe('true')
    await down.trigger('click')
    expect(wrapper.emitted('update:commands')).toHaveLength(1)
  })

  it('offers keyboard reorder controls and reorders commands by dragging the shared handle', async () => {
    const wrapper = mount(SettingsCommandsTab, {
      props: {
        userConfig: {
          launcherPages: [],
          commands: [webhook, script],
          mainActions: [],
        } as unknown as UserConfig,
      },
      attachTo: document.body,
      global: { stubs: { CommandEditor: true, Icon: true } },
    })

    expect(wrapper.find('[aria-label^="common.moveUp"]').exists()).toBe(true)
    expect(wrapper.find('[aria-label^="common.moveDown"]').exists()).toBe(true)

    const cards = wrapper.findAll('.command-card')
    cards.forEach(({ element }, index) => {
      const top = index * 48
      vi.spyOn(element, 'getBoundingClientRect').mockReturnValue({
        top,
        bottom: top + 40,
        height: 40,
        left: 0,
        right: 100,
      } as DOMRect)
    })

    const dispatch = (
      type: string,
      clientY: number,
      target: EventTarget = window
    ) => {
      const event = new MouseEvent(type, {
        clientY,
        clientX: 20,
        bubbles: true,
      })
      Object.defineProperty(event, 'pointerId', { value: 1 })
      target.dispatchEvent(event)
    }

    dispatch('pointerdown', 10, wrapper.findAll('.drag-handle')[0].element)
    await wrapper.vm.$nextTick()
    dispatch('pointermove', 70)
    await wrapper.vm.$nextTick()
    dispatch('pointerup', 70)
    await wrapper.vm.$nextTick()

    expect(wrapper.emitted('update:commands')).toBeTruthy()
    expect(
      (wrapper.emitted('update:commands')![0][0] as CommandConfig[]).map(
        (command) => command.id
      )
    ).toEqual(['sc1', 'wh1'])
    wrapper.unmount()
  })

  it('lists the commands and marks the ones in the menu', () => {
    const wrapper = mountTab()
    const cards = wrapper.findAll('.command-card')
    expect(cards).toHaveLength(2)
    expect(cards[0].text()).toContain('Hook')
    expect(cards[0].text()).toContain('commands.badgeInMenu')
    expect(cards[1].text()).not.toContain('commands.badgeInMenu')
    expect(cards[1].find('.command-placements').text()).toBe('')
  })

  it('shows action keys and assignments on every launcher page', async () => {
    const wrapper = mountTab()
    await wrapper.setProps({
      userConfig: {
        ...wrapper.props('userConfig'),
        launcherPages: [['wh1'], [null, 'wh1'], ['sc1']].map(
          (slots, index) => ({
            id: `page-${index}`,
            slots,
            inputMode: 'selection' as const,
          })
        ),
      },
    })
    const placements = wrapper.findAll('.command-placements')
    expect(placements[0].text()).toContain('"key":"Q"')
    expect(placements[0].text()).toContain('"page":1,"key":"Q"')
    expect(placements[0].text()).toContain('"page":2,"key":"W"')
    expect(placements[1].text()).toContain('"page":3,"key":"Q"')
    await placements[0].find('button').trigger('click')
    await placements[0].findAll('button')[1].trigger('click')
    expect(wrapper.emitted('navigate')).toEqual([
      ['main-actions'],
      ['launcher-commands'],
    ])
    expect(wrapper.find('.command-body').exists()).toBe(false)
  })

  it('copies the id of a command from its menu', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined)
    Object.defineProperty(navigator, 'clipboard', {
      value: { writeText },
      configurable: true,
    })
    const wrapper = mountTab()
    await pickMenuItem(wrapper, 1, '.dropdown-item:not(.is-danger)')
    expect(writeText).toHaveBeenCalledWith('sc1')
    expect(toastKey).toHaveBeenCalledWith('commands.idCopied', 'success')
  })

  it('opens the editor of the focused command', () => {
    const wrapper = mountTab('sc1')
    const cards = wrapper.findAll('.command-card')
    expect(cards[0].find('.command-body').exists()).toBe(false)
    expect(cards[1].find('.command-body').exists()).toBe(true)
  })

  it('adds a new command of the tool picked from the registry', async () => {
    const wrapper = mountTab()
    expect(wrapper.find('.tool-picker').exists()).toBe(false)
    await wrapper.find('.add-btn').trigger('click')
    const options = wrapper.findAll('.tool-option')
    expect(options.map((option) => option.text())).toEqual([
      expect.stringContaining('action.script'),
      expect.stringContaining('action.webhook'),
    ])
    await options[1].trigger('click')
    const [commands] = wrapper.emitted('update:commands')![0] as [
      { toolId: string }[],
    ]
    expect(commands.map((command) => command.toolId)).toEqual([
      'webhook',
      'script',
      'webhook',
    ])
    expect(wrapper.find('.tool-picker').exists()).toBe(false)
  })

  it('removes a command with its menu items and offers to undo it', async () => {
    removeSecret.mockClear()
    const wrapper = mountTab()
    await pickMenuItem(wrapper, 0, '.dropdown-item.is-danger')

    const [commands] = wrapper.emitted('update:commands')![0] as [
      { id: string }[],
    ]
    expect(commands.map((command) => command.id)).toEqual(['sc1'])
    expect(wrapper.emitted('update:mainActions')![0]).toEqual([
      [null, { type: 'standard', actionId: 'translation' }],
    ])
    expect(wrapper.find('.commands-notice').text()).toContain(
      'commands.removed'
    )
    // the token stays while the removal can be undone
    expect(removeSecret).not.toHaveBeenCalled()
  })

  it('puts a removed command back where it was', async () => {
    removeSecret.mockClear()
    const wrapper = mountTab()
    await pickMenuItem(wrapper, 0, '.dropdown-item.is-danger')
    await wrapper.setProps({
      userConfig: {
        ...wrapper.props('userConfig'),
        commands: [script],
        mainActions: [null, { type: 'standard', actionId: 'translation' }],
      } as unknown as UserConfig,
    })
    await wrapper.find('.commands-notice button').trigger('click')

    const [commands] = wrapper.emitted('update:commands')![1] as [
      { id: string }[],
    ]
    expect(commands.map((command) => command.id)).toEqual(['wh1', 'sc1'])
    expect(wrapper.emitted('update:mainActions')![1]).toEqual([
      [
        { type: 'command', commandId: 'wh1' },
        { type: 'standard', actionId: 'translation' },
      ],
    ])
    expect(wrapper.find('.commands-notice').exists()).toBe(false)
    wrapper.unmount()
    expect(removeSecret).not.toHaveBeenCalled()
  })

  it('removes the webhook token once undo is no longer offered', async () => {
    removeSecret.mockClear()
    const wrapper = mountTab()
    await pickMenuItem(wrapper, 0, '.dropdown-item.is-danger')
    const emitted = wrapper
      .emitted('update:commands')!
      .at(-1)![0] as CommandConfig[]
    await wrapper.setProps({
      userConfig: { ...wrapper.props('userConfig'), commands: emitted },
    })
    wrapper.unmount()
    await vi.waitFor(() =>
      expect(removeSecret).toHaveBeenCalledWith('webhook-auth-wh1')
    )
  })

  it('switches a command on and off with a matching title', async () => {
    const wrapper = mountTab()
    const card = wrapper.findAll('.command-card')[1]
    expect(card.find('.enabled-switch input').attributes('title')).toBe(
      'commands.disable'
    )
    expect(card.find('.external-btn').exists()).toBe(false)
    await card.find('.enabled-switch input').setValue(false)

    const [disabled] = wrapper.emitted('update:commands')![0] as [
      CommandConfig[],
    ]
    expect(disabled[1].enabled).toBe(false)
    expect(disabled[0].enabled).toBe(true)
    await wrapper.setProps({
      userConfig: { ...wrapper.props('userConfig'), commands: disabled },
    })
    expect(card.find('.enabled-switch input').attributes('title')).toBe(
      'commands.enable'
    )
    await card.find('.enabled-switch input').setValue(true)
    const [enabled] = wrapper.emitted('update:commands')![1] as [
      CommandConfig[],
    ]
    expect(enabled[1].enabled).toBe(true)
  })

  it('grants selection capture without touching the commands', async () => {
    const wrapper = mountTab()
    await wrapper.findAll('.field-row input[type="checkbox"]')[0].setValue(true)
    expect(wrapper.emitted('update:externalAccess')?.[0]).toEqual([
      { selection: true },
    ])
    expect(wrapper.emitted('update:commands')).toBeUndefined()
  })
})
