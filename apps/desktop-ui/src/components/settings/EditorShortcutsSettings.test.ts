import { mount } from '@vue/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { DEFAULT_USER_CONFIG } from '@tyco/shared'
import { createTestSettingsContext } from '../../test/settings-context'
import {
  loadFakeDesktop,
  type TestDesktop,
} from '../../test/install-fake-desktop'
import EditorShortcutsSettings from './EditorShortcutsSettings.vue'
import HotkeyInput from './HotkeyInput.vue'

vi.mock('../../composables/use-i18n', () => ({
  useI18n: () => ({ t: (key: string) => key }),
}))

describe('editor shortcut settings', () => {
  let desktop: TestDesktop
  beforeEach(async () => {
    desktop = await loadFakeDesktop()
    desktop.backend.handle('suspend_hotkeys', () => undefined)
  })
  afterEach(() => desktop.dispose())

  function setup() {
    const context = createTestSettingsContext()
    context.draft.value.hotkeys.editor = 'Ctrl+Alt+9'
    const wrapper = mount(EditorShortcutsSettings, {
      global: { plugins: [desktop.pinia], provide: context.provide },
    })
    return { context, wrapper, bold: wrapper.findAllComponents(HotkeyInput)[0] }
  }

  it('renders an anchor id on the section for direct navigation', () => {
    const { wrapper } = setup()
    expect(wrapper.find('#editor-shortcuts').exists()).toBe(true)
  })

  it('records a new shortcut into the persistent settings draft', async () => {
    const { context, bold } = setup()
    await bold.trigger('click')
    await bold.trigger('keydown', { key: 'и', code: 'KeyB', altKey: true })
    expect(context.draft.value.editor.shortcuts.bold).toBe('Alt+B')
    expect(bold.props('modelValue')).toBe('Alt+B')
  })

  it('rejects duplicates, reserved editing keys and configured global shortcuts', async () => {
    const { context, wrapper, bold } = setup()
    for (const shortcut of [
      'Ctrl+I',
      'Ctrl+C',
      context.draft.value.hotkeys.editor,
    ]) {
      bold.vm.$emit('update:modelValue', shortcut)
      await wrapper.vm.$nextTick()
      expect(context.draft.value.editor.shortcuts.bold).toBe('Ctrl+B')
    }
    expect(wrapper.text()).toContain('settings.editorShortcuts.reserved')
  })

  it('clears and restores a default binding', async () => {
    const { context, wrapper, bold } = setup()
    bold.vm.$emit('update:modelValue', '')
    await wrapper.vm.$nextTick()
    expect(context.draft.value.editor.shortcuts.bold).toBe('')
    const reset = wrapper
      .findAll('button')
      .find(
        (button) =>
          button.attributes('aria-label') === 'settings.resetToDefault'
      )
    expect(reset).toBeDefined()
    await reset!.trigger('click')
    expect(context.draft.value.editor.shortcuts.bold).toBe(
      DEFAULT_USER_CONFIG.editor.shortcuts.bold
    )
  })

  it('captures Tab and Shift+Tab but does not capture ordinary typing', async () => {
    const { wrapper, bold } = setup()
    await bold.trigger('click')
    await bold.trigger('keydown', { key: 'A', code: 'KeyA', shiftKey: true })
    expect(bold.classes()).toContain('is-invalid')
    await bold.trigger('keydown', { key: 'Escape', code: 'Escape' })
    expect(bold.emitted('update:modelValue')).toBeUndefined()
    // Existing assignments are rejected as duplicates, but the recorder emits them.
    await bold.trigger('click')
    await bold.trigger('keydown', { key: 'Tab', code: 'Tab', shiftKey: true })
    await wrapper.vm.$nextTick()
    expect(bold.emitted('update:modelValue')?.at(-1)).toEqual(['Shift+Tab'])
  })
})
