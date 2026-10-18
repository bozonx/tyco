import { mount } from '@vue/test-utils'
import { describe, expect, it, vi } from 'vitest'
import type { UserConfig } from '@tyco/shared'

import { createTestSettingsContext } from '../../test/settings-context'
import SettingsAccessibilityTab from './SettingsAccessibilityTab.vue'

vi.mock('../../composables/use-i18n', () => ({
  useI18n: () => ({ t: (key: string) => key }),
}))

describe('SettingsAccessibilityTab.vue', () => {
  let context: ReturnType<typeof createTestSettingsContext>
  const mountTab = (appearance: UserConfig['appearance']) => {
    context = createTestSettingsContext({ appearance })
    return mount(SettingsAccessibilityTab, {
      global: {
        provide: context.provide,
        stubs: {
          SettingsSection: {
            props: ['title'],
            template:
              '<section class="section-stub" :data-title="title"><slot /></section>',
          },
          FieldRow: {
            props: ['label', 'hint'],
            template:
              '<div class="field-row-stub" :data-label="label" :data-hint="hint"><slot /></div>',
          },
          FieldSelect: {
            props: ['modelValue', 'disabled', 'options'],
            template:
              '<input class="field-select-stub" :value="modelValue" :disabled="disabled" @input="$emit(\'update:modelValue\', $event.target.value)" />',
          },
        },
      },
    })
  }

  it('renders contrast, motion, and UI scale options enabled when theme is not e-ink', () => {
    const appearance: UserConfig['appearance'] = {
      theme: 'dark',
      contrast: 'normal',
      motion: 'auto',
      uiScalePercent: 100,
    }
    const wrapper = mountTab(appearance)

    const selects = wrapper.findAll('.field-select-stub')
    expect(selects).toHaveLength(3)

    expect(selects[0].attributes('disabled')).toBeUndefined()
    expect(selects[1].attributes('disabled')).toBeUndefined()
    expect(selects[2].attributes('disabled')).toBeUndefined()

    const rows = wrapper.findAll('.field-row-stub')
    expect(rows[0].attributes('data-hint')).toBeUndefined()
  })

  it('disables contrast and motion when theme is e-ink and displays hint', () => {
    const appearance: UserConfig['appearance'] = {
      theme: 'e-ink',
      contrast: 'more',
      motion: 'reduce',
      uiScalePercent: 130,
    }
    const wrapper = mountTab(appearance)

    const selects = wrapper.findAll('.field-select-stub')
    expect(selects[0].attributes('disabled')).toBeDefined()
    expect(selects[1].attributes('disabled')).toBeDefined()
    expect(selects[2].attributes('disabled')).toBeUndefined()

    const rows = wrapper.findAll('.field-row-stub')
    expect(rows[0].attributes('data-hint')).toBe('settings.forcedByEInk')
    expect(rows[1].attributes('data-hint')).toBe('settings.forcedByEInk')
  })

  it('stores the appearance when contrast is changed', async () => {
    const appearance: UserConfig['appearance'] = {
      theme: 'light',
      contrast: 'normal',
      motion: 'auto',
      uiScalePercent: 100,
    }
    const wrapper = mountTab(appearance)

    const selects = wrapper.findAll('.field-select-stub')
    await selects[0].setValue('more')

    expect(context.draft.value.appearance).toEqual({
      ...appearance,
      contrast: 'more',
    })
  })

  it('stores the appearance when motion is changed', async () => {
    const appearance: UserConfig['appearance'] = {
      theme: 'light',
      contrast: 'normal',
      motion: 'auto',
      uiScalePercent: 100,
    }
    const wrapper = mountTab(appearance)

    const selects = wrapper.findAll('.field-select-stub')
    await selects[1].setValue('reduce')

    expect(context.draft.value.appearance).toEqual({
      ...appearance,
      motion: 'reduce',
    })
  })

  it('stores the appearance when uiScalePercent is changed to a valid scale', async () => {
    const appearance: UserConfig['appearance'] = {
      theme: 'light',
      contrast: 'normal',
      motion: 'auto',
      uiScalePercent: 100,
    }
    const wrapper = mountTab(appearance)

    const selects = wrapper.findAll('.field-select-stub')
    await selects[2].setValue('115')

    expect(context.draft.value.appearance).toEqual({
      ...appearance,
      uiScalePercent: 115,
    })
  })
})
