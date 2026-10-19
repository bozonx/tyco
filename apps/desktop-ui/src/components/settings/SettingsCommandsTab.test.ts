import { mount } from '@vue/test-utils'
import { describe, expect, it, vi } from 'vitest'
import { nextTick } from 'vue'

import { createCommand } from '../../lib/commands/command-config'
import { createTestSettingsContext } from '../../test/settings-context'
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

vi.mock('../../stores/secrets', () => ({
  useSecretsStore: () => ({ removeSecret }),
}))
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
    authSecretId: 'webhook.auth.wh1',
  },
}
const script = { ...createCommand('script', 'sc1'), name: 'Backup' }

let context: ReturnType<typeof createTestSettingsContext>

const mountTab = (focusCommandId?: string) => {
  context = createTestSettingsContext({
    launcherPages: [],
    commands: [webhook, script],
    mainActions: {
      q: { type: 'command', commandId: 'wh1' },
      w: { type: 'standard', actionId: 'translationMenu' },
    },
  } as Partial<UserConfig>)
  return mount(SettingsCommandsTab, {
    props: { focusCommandId },
    global: {
      provide: context.provide,
      stubs: { Teleport: true, CommandEditor: true },
    },
  })
}

const commandIds = () => context.draft.value.commands.map(({ id }) => id)

/** Picks an item of the menu of the card, e.g. the danger one: delete */
async function pickMenuItem(
  wrapper: ReturnType<typeof mountTab>,
  card: number,
  selector: string
) {
  const header = wrapper.findAll('.disclosure-panel-header')[card]
  await header.find('.dropdown-trigger').trigger('click')
  await header.find(selector).trigger('click')
}

describe('SettingsCommandsTab.vue', () => {
  it('reorders commands by dragging the shared handle', async () => {
    context = createTestSettingsContext({
      launcherPages: [],
      commands: [webhook, script],
      mainActions: {},
    } as Partial<UserConfig>)
    const wrapper = mount(SettingsCommandsTab, {
      attachTo: document.body,
      global: { provide: context.provide, stubs: { CommandEditor: true } },
    })

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

    expect(commandIds()).toEqual(['sc1', 'wh1'])
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
    context.draft.value.launcherPages = [
      { q: 'wh1' },
      { w: 'wh1' },
      { q: 'sc1' },
    ].map((slots, index) => ({
      id: `page-${index}`,
      inputMode: 'selection' as const,
      hotkey: '',
      slots,
    }))
    await nextTick()
    const placements = wrapper.findAll('.command-placements')
    expect(placements[0].text()).toContain('"key":"Q"')
    expect(placements[0].text()).toContain('"page":1,"key":"Q"')
    expect(placements[0].text()).toContain('"page":2,"key":"W"')
    expect(placements[1].text()).toContain('"page":3,"key":"Q"')
    expect(placements[0].findAll('button')).toHaveLength(0)
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
    expect(toastKey).toHaveBeenCalledWith('common.copied', 'success')
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
    expect(
      context.draft.value.commands.map((command) => command.toolId)
    ).toEqual(['webhook', 'webhook', 'script'])
    expect(wrapper.find('.tool-picker').exists()).toBe(false)

    await nextTick()
    const firstCard = wrapper.findAllComponents({ name: 'CommandCard' })[0]
    expect(firstCard.props('autofocusName')).toBe(true)
    expect(firstCard.props('expanded')).toBe(true)
  })

  it('removes a command with its menu items and offers to undo it', async () => {
    removeSecret.mockClear()
    const wrapper = mountTab()
    await pickMenuItem(wrapper, 0, '.dropdown-item.is-danger')

    expect(commandIds()).toEqual(['sc1'])
    expect(context.draft.value.mainActions).toEqual({
      w: { type: 'standard', actionId: 'translationMenu' },
    })
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
    await wrapper.find('.commands-notice button').trigger('click')

    expect(commandIds()).toEqual(['wh1', 'sc1'])
    expect(context.draft.value.mainActions).toEqual({
      q: { type: 'command', commandId: 'wh1' },
      w: { type: 'standard', actionId: 'translationMenu' },
    })
    expect(wrapper.find('.commands-notice').exists()).toBe(false)
    wrapper.unmount()
    expect(removeSecret).not.toHaveBeenCalled()
  })

  it('removes the webhook token once undo is no longer offered', async () => {
    removeSecret.mockClear()
    const wrapper = mountTab()
    await pickMenuItem(wrapper, 0, '.dropdown-item.is-danger')
    wrapper.unmount()
    await vi.waitFor(() =>
      expect(removeSecret).toHaveBeenCalledWith('webhook.auth.wh1')
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

    const commands = () => context.draft.value.commands as CommandConfig[]
    expect(commands()[1].isEnabled).toBe(false)
    expect(commands()[0].isEnabled).toBe(true)
    await nextTick()
    expect(card.find('.enabled-switch input').attributes('title')).toBe(
      'commands.enable'
    )
    await card.find('.enabled-switch input').setValue(true)
    expect(commands()[1].isEnabled).toBe(true)
  })

  it('grants selection capture without touching the commands', async () => {
    const wrapper = mountTab()
    const commands = context.draft.value.commands
    await wrapper.findAll('.field-row input[type="checkbox"]')[0].setValue(true)
    expect(context.draft.value.externalAccess).toEqual({
      canAccessSelection: true,
    })
    expect(context.draft.value.commands).toBe(commands)
  })
})
