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
vi.mock('../../stores/ai-profiles', () => ({
  useAiProfilesStore: () => ({
    profiles: [{ id: 'assistant', name: 'Assistant' }],
    getProfile: (id: string) =>
      id === 'assistant' ? { id: 'assistant', name: 'Assistant' } : undefined,
  }),
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
      actionPages: [
        {
          inputMode: 'selection',
          slots: { q: { type: 'standard', actionId: 'correction' } },
        },
      ],
      transformations: {
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
      global: {
        provide: context.provide,
        stubs: { ShortcutSlots, ConfirmModal: true },
      },
    })
  const optionTexts = (wrapper: ReturnType<typeof mountTab>) =>
    wrapper.findAll('option').map((option) => option.text())

  it('offers standard actions, profiles, named transformations and plugin actions', () => {
    const wrapper = mountTab()
    const texts = optionTexts(wrapper)
    const optgroupLabels = wrapper
      .findAll('optgroup')
      .map((group) => group.attributes('label'))
    expect(optgroupLabels).toContain('settings.promptPageProfile: Assistant')
    expect(optgroupLabels).toContain('quickAiRequest.defaultProfile')
    expect(optgroupLabels).toContain('nav.menu')
    expect(texts).toContain('action.voiceCommands…')
    expect(texts).toContain('action.voiceCommandsWithoutContext…')
    expect(texts).toContain('action.correction')
    expect(texts).toContain('settings.hotkeyActions.selectionCorrection')
    expect(texts).toContain('action.askInChat')
    expect(texts).toContain('action.quickAiRequest…')
    expect(texts).toContain('action.transformationMenu…')
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
    expect(context.draft.value.actionPages[0].slots.q).toEqual({
      type: 'transformation',
      transformationId: 'shorten',
    })
  })

  it.each(['voiceCommands', 'voiceCommandsWithoutContext'])(
    'assigns %s to a shortcut slot',
    async (actionId) => {
      const wrapper = mountTab()
      const select = wrapper.get('select')
      const option = select
        .findAll('option')
        .find((item) => item.text() === `action.${actionId}…`)!
      await select.setValue(option.element.value)
      expect(context.draft.value.actionPages[0].slots.q).toEqual({
        type: 'standard',
        actionId,
      })
    }
  )

  it('adds, moves and removes slots', async () => {
    const wrapper = mountTab()
    await wrapper.get('.add').trigger('click')
    expect(context.draft.value.actionPages[0].slots.w).toEqual({
      type: 'standard',
      actionId: 'insertIntoWindow',
    })
    await wrapper.get('.move').trigger('click')
    expect(context.draft.value.actionPages[0].slots.q).toEqual({
      type: 'standard',
      actionId: 'insertIntoWindow',
    })
    await wrapper.findAll('.remove')[0]!.trigger('click')
    expect(context.draft.value.actionPages[0].slots.q).toBeUndefined()
  })

  it('names slots whose action is gone', () => {
    configure({
      actionPages: [
        {
          inputMode: 'selection',
          slots: {
            q: { type: 'transformation', transformationId: 'removed' },
            w: { type: 'command', commandId: 'missing' },
            e: { type: 'profile', profileId: 'removed', action: 'chat' },
          },
        },
      ],
    })
    const texts = optionTexts(mountTab())
    expect(texts).toContain('settings.mainActionTransformationRemoved')
    expect(texts).toContain('commands.unavailableInMenu:{"name":"missing"}')
    expect(texts).toContain('settings.mainActionProfileRemoved')
  })

  it('opens the command of a slot for editing', async () => {
    configure({
      actionPages: [
        {
          inputMode: 'selection',
          slots: { q: { type: 'command', commandId: 'cmd1' } },
        },
      ],
    })
    const wrapper = mountTab()
    await wrapper
      .findComponent({ name: 'IconButton' })
      .vm.$emit('click', new MouseEvent('click'))
    expect(context.editCommand).toHaveBeenCalledWith('cmd1')
  })

  it('adds, removes and switches action pages with takesText switch rules', async () => {
    const wrapper = mountTab()
    // 1 page initially: delete button is disabled
    const buttons = wrapper.findAllComponents({ name: 'Button' })
    const removeBtn = buttons.find((b) =>
      b.text().includes('settings.removeActionPage')
    )!
    expect(removeBtn.props('disabled')).toBe(true)

    // Add page
    const addBtn = buttons.find((b) =>
      b.text().includes('settings.addActionPage')
    )!
    await addBtn.trigger('click')
    expect(context.draft.value.actionPages).toHaveLength(2)

    // Now on page 2: remove button is enabled
    expect(
      wrapper
        .findAllComponents({ name: 'Button' })
        .find((b) => b.text().includes('settings.removeActionPage'))!
        .props('disabled')
    ).toBe(false)

    // FieldSwitch on page 2 can be toggled
    const fieldSwitch = wrapper.findComponent({ name: 'FieldSwitch' })
    expect(fieldSwitch.props('disabled')).toBe(false)
    fieldSwitch.vm.$emit('update:modelValue', false)
    await wrapper.vm.$nextTick()
    expect(context.draft.value.actionPages[1].inputMode).toBe('none')

    // Switch back to page 1
    const page1Btn = wrapper.findAllComponents({ name: 'Button' })[0]!
    await page1Btn.trigger('click')
    // FieldSwitch on page 1 is disabled
    expect(
      wrapper.findComponent({ name: 'FieldSwitch' }).props('disabled')
    ).toBe(true)

    // Delete page 2
    const page2Btn = wrapper.findAllComponents({ name: 'Button' })[1]!
    await page2Btn.trigger('click')
    const deleteBtn = wrapper
      .findAllComponents({ name: 'Button' })
      .find((b) => b.text().includes('settings.removeActionPage'))!
    await deleteBtn.trigger('click')
    expect(context.draft.value.actionPages).toHaveLength(1)
  })
  it('asks before removing a populated page and keeps it when cancelled', async () => {
    configure({
      actionPages: [
        { inputMode: 'selection', slots: {} },
        {
          inputMode: 'none',
          slots: { q: { type: 'standard', actionId: 'voiceInput' } },
        },
      ],
    })
    const wrapper = mountTab()
    await wrapper.findAllComponents({ name: 'Button' })[1]!.trigger('click')
    await wrapper
      .findAllComponents({ name: 'Button' })
      .find((b) => b.text().includes('settings.removeActionPage'))!
      .trigger('click')
    const modal = wrapper.findComponent({ name: 'ConfirmModal' })
    expect(modal.props('open')).toBe(true)
    expect(context.draft.value.actionPages).toHaveLength(2)
    modal.vm.$emit('cancel')
    await wrapper.vm.$nextTick()
    expect(modal.props('open')).toBe(false)
    expect(context.draft.value.actionPages).toHaveLength(2)
    await wrapper
      .findAllComponents({ name: 'Button' })
      .find((b) => b.text().includes('settings.removeActionPage'))!
      .trigger('click')
    modal.vm.$emit('confirm')
    expect(context.draft.value.actionPages).toHaveLength(1)
  })
})
