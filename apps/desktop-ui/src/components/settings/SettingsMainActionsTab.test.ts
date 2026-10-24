import { mount } from '@vue/test-utils'
import { DEFAULT_USER_CONFIG, type UserConfig } from '@tyco/shared'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { createTestSettingsContext } from '../../test/settings-context'
import SettingsMainActionsTab from './SettingsMainActionsTab.vue'

vi.mock('../../composables/use-i18n', () => ({
  useI18n: () => ({
    locale: { value: 'en-US' },
    t: (key: string, params?: Record<string, unknown>) =>
      params ? `${key}:${JSON.stringify(params)}` : key,
  }),
}))
vi.mock('../../stores/action-menu', () => ({
  useActionMenuStore: () => ({
    getRegisteredActions: () => [
      { id: 'Sample:shout', label: 'Shout', ownerPluginId: 'Sample' },
      { label: 'Without id' },
    ],
  }),
}))
vi.mock('../../stores/plugin-runtime', () => ({
  usePluginRuntimeStore: () => ({ pluginFactories: [] }),
}))
vi.mock('../../stores/tools', async () => {
  const { testTools } = await import('../../lib/tools/testing')
  const tools = testTools()
  return { useToolsStore: () => tools }
})

/** Renders each slot through the item template, with buttons for the grid */
const ShortcutSlots = {
  props: ['items'],
  template: `
    <div>
      <div v-for="(item, index) in items" :key="index" class="slot">
        <slot v-if="item" name="item" :item="item" :index="index" />
        <button v-else class="add" @click="$emit('add', index)" />
        <button class="remove" @click="$emit('remove', index)" />
      </div>
      <button class="move" @click="$emit('move', 0, 1)" />
    </div>`,
}

describe('SettingsMainActionsTab.vue', () => {
  let context: ReturnType<typeof createTestSettingsContext>
  const configure = (patch: Partial<UserConfig>) => {
    context = createTestSettingsContext({
      ...structuredClone(DEFAULT_USER_CONFIG),
      isInDevelopment: true,
      ...patch,
    })
  }
  beforeEach(() =>
    configure({
      mainActions: { q: { type: 'standard', actionId: 'correction' } },
      aiTasks: {
        items: [
          { id: 'shorten', name: 'Shorten', rule: 'Make it short' },
          { id: 'unnamed', name: ' ', rule: 'Hidden' },
        ],
        slots: {},
      },
    })
  )

  const mountTab = () =>
    mount(SettingsMainActionsTab, {
      global: { provide: context.provide, stubs: { ShortcutSlots } },
    })
  const optionTexts = (wrapper: ReturnType<typeof mountTab>) =>
    wrapper.findAll('option').map((option) => option.text())

  it('hides development choices and keeps saved actions', () => {
    configure({
      isInDevelopment: false,
      mainActions: {
        q: { type: 'standard', actionId: 'askInChat' },
        w: { type: 'standard', actionId: 'correction' },
      },
    })
    const wrapper = mountTab()
    expect(optionTexts(wrapper)).not.toContain('action.askInChat')
    expect(optionTexts(wrapper)).toContain('action.correction')
    expect(context.draft.value.mainActions.q).toEqual({
      type: 'standard',
      actionId: 'askInChat',
    })
  })

  it('offers standard actions, named tasks and plugin actions', () => {
    const texts = optionTexts(mountTab())
    expect(texts).toContain('action.correction')
    expect(texts).toContain('action.aiTaskMenu…')
    expect(texts).toContain('Shorten')
    expect(texts).toContain('Shout')
    expect(texts).not.toContain('Without id')
    expect(texts.join()).not.toContain('Hidden')
  })

  it('replaces a slot with the picked action', async () => {
    const wrapper = mountTab()
    const select = wrapper.get('select')
    const shorten = select
      .findAll('option')
      .find((option) => option.text() === 'Shorten')!
    await select.setValue(shorten.element.value)
    expect(context.draft.value.mainActions.q).toEqual({
      type: 'aiTask',
      taskId: 'shorten',
    })
  })

  it('adds, moves and removes slots', async () => {
    const wrapper = mountTab()
    await wrapper.get('.add').trigger('click')
    expect(context.draft.value.mainActions.w).toEqual({
      type: 'standard',
      actionId: 'insertIntoWindow',
    })
    await wrapper.get('.move').trigger('click')
    expect(context.draft.value.mainActions.q).toEqual({
      type: 'standard',
      actionId: 'insertIntoWindow',
    })
    await wrapper.findAll('.remove')[0]!.trigger('click')
    expect(context.draft.value.mainActions.q).toBeUndefined()
  })

  it('names slots whose action is gone', () => {
    configure({
      mainActions: {
        q: { type: 'aiTask', taskId: 'removed' },
        w: { type: 'command', commandId: 'missing' },
      },
    })
    const texts = optionTexts(mountTab())
    expect(texts).toContain('settings.mainActionTaskRemoved')
    expect(texts).toContain('commands.unavailableInMenu:{"name":"missing"}')
  })

  it('opens the command of a slot for editing', async () => {
    configure({ mainActions: { q: { type: 'command', commandId: 'cmd1' } } })
    const wrapper = mountTab()
    await wrapper
      .findComponent({ name: 'IconButton' })
      .vm.$emit('click', new MouseEvent('click'))
    expect(context.editCommand).toHaveBeenCalledWith('cmd1')
  })
})
