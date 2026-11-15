import { mount } from '@vue/test-utils'
import { afterEach, expect, it, vi } from 'vitest'

import { i18n } from '../../lib/i18n'
import SettingsSaveStatus from './SettingsSaveStatus.vue'

afterEach(() => vi.useRealTimers())
const initial = {
  configIsNewer: false,
  isSaving: false,
  isReloading: false,
  saveError: '',
  conflicts: [] as string[],
}

it('shows pending saves and only briefly confirms a completed save', async () => {
  vi.useFakeTimers()
  const wrapper = mount(SettingsSaveStatus, {
    props: initial,
    global: { plugins: [i18n] },
  })
  const status = () => wrapper.get('.settings-autosave-content').text()
  expect(status()).toBe('')
  await wrapper.setProps({ hasUnsavedChanges: true })
  expect(status()).toBe(i18n.global.t('settings.autosaveSaving'))
  await wrapper.setProps({ isSaving: true })
  await wrapper.setProps({ isSaving: false, hasUnsavedChanges: false })
  expect(status()).toBe(i18n.global.t('settings.autosaveSaved'))
  await vi.advanceTimersByTimeAsync(1500)
  expect(status()).toBe('')
  wrapper.unmount()
})

it('keeps a failed save visible and does not report success until retry succeeds', async () => {
  const wrapper = mount(SettingsSaveStatus, {
    props: initial,
    global: { plugins: [i18n] },
  })
  await wrapper.setProps({ isSaving: true })
  await wrapper.setProps({ isSaving: false, saveError: 'Disk is full' })
  expect(wrapper.text()).toContain('Disk is full')
  expect(wrapper.find('.settings-autosave-content').exists()).toBe(false)
  await wrapper.setProps({ isSaving: true })
  expect(wrapper.text()).toContain('Disk is full')
  await wrapper.setProps({ isSaving: false, saveError: '' })
  expect(wrapper.get('.settings-autosave-content').text()).toBe(
    i18n.global.t('settings.autosaveSaved')
  )
  wrapper.unmount()
})
