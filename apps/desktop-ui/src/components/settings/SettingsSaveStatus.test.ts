import { mount } from '@vue/test-utils'
import { expect, it } from 'vitest'

import { i18n } from '../../lib/i18n'
import SettingsSaveStatus from './SettingsSaveStatus.vue'

const initial = {
  configIsNewer: false,
  isSaving: false,
  isReloading: false,
  saveError: '',
  conflicts: [] as string[],
}

it('shows nothing while saving or after a successful save', async () => {
  const wrapper = mount(SettingsSaveStatus, {
    props: initial,
    global: { plugins: [i18n] },
  })
  expect(wrapper.get('[role="status"]').text()).toBe('')
  await wrapper.setProps({ isSaving: true })
  expect(wrapper.get('[role="status"]').text()).toBe('')
  await wrapper.setProps({ isSaving: false })
  expect(wrapper.get('[role="status"]').text()).toBe('')
  wrapper.unmount()
})

it('shows a failed save and clears it once retry succeeds', async () => {
  const wrapper = mount(SettingsSaveStatus, {
    props: initial,
    global: { plugins: [i18n] },
  })
  await wrapper.setProps({ isSaving: true })
  await wrapper.setProps({ isSaving: false, saveError: 'Disk is full' })
  expect(wrapper.text()).toContain('Disk is full')
  await wrapper.setProps({ isSaving: true })
  expect(wrapper.text()).toContain('Disk is full')
  await wrapper.setProps({ isSaving: false, saveError: '' })
  expect(wrapper.get('[role="status"]').text()).toBe('')
  wrapper.unmount()
})
