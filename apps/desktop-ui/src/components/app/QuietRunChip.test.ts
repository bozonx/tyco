import { mount } from '@vue/test-utils'
import { nextTick } from 'vue'
import { expect, it } from 'vitest'

import { i18n } from '../../lib/i18n/index'
import { useQuietRunStore } from '../../stores/quiet-run'
import { loadFakeDesktop } from '../../test/install-fake-desktop'
import QuietRunChip from './QuietRunChip.vue'

it('shows the running command, cancels it, and opens history on completion', async () => {
  const desktop = await loadFakeDesktop()
  desktop.backend.handle('cancel_external_job', () => undefined)
  const wrapper = mount(QuietRunChip, {
    global: { plugins: [desktop.pinia, i18n] },
  })
  const store = useQuietRunStore()
  const run = { commandName: 'Backup', jobId: 'job', startedAt: null }
  try {
    expect(wrapper.find('button').exists()).toBe(false)
    store.update({ ...run, state: 'accepted' })
    await nextTick()
    expect(wrapper.get('button').text()).toContain('Backup')
    await wrapper.get('button').trigger('click')
    await wrapper.get('.quiet-run-popover button').trigger('click')
    expect(desktop.backend.calls).toContainEqual({
      command: 'cancel_external_job',
      args: { id: 'job' },
    })
    store.update({ ...run, state: 'cancelled', historyId: 'record' })
    await nextTick()
    await wrapper.get('button').trigger('click')
    expect(wrapper.emitted('openHistory')).toHaveLength(1)
  } finally {
    wrapper.unmount()
    desktop.dispose()
  }
})

it('ignores an older completion during a new active job and shows its original start time', async () => {
  const desktop = await loadFakeDesktop()
  const wrapper = mount(QuietRunChip, {
    attachTo: document.body,
    global: { plugins: [desktop.pinia, i18n] },
  })
  const store = useQuietRunStore()
  try {
    store.update({
      jobId: 'new',
      commandName: 'New run',
      state: 'running',
      startedAt: Date.now() - 3_665_000,
    })
    store.update({
      jobId: 'old',
      commandName: 'Previous run',
      state: 'failed',
      startedAt: null,
    })
    await nextTick()
    expect(wrapper.text()).not.toContain('Previous run')
    const trigger = wrapper.get('button[aria-expanded]')
    ;(trigger.element as HTMLButtonElement).focus()
    await trigger.trigger('click')
    expect(wrapper.get('time').text()).toBe('1:01:05')
    await trigger.trigger('keydown', { key: 'Escape' })
    expect(wrapper.find('time').exists()).toBe(false)
    await trigger.trigger('click')
    document.body.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    await nextTick()
    expect(wrapper.find('time').exists()).toBe(false)
  } finally {
    wrapper.unmount()
    desktop.dispose()
  }
})
