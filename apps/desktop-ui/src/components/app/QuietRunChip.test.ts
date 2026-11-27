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
  const run = { commandName: 'Backup', jobId: 'job' }
  try {
    expect(wrapper.find('summary').exists()).toBe(false)
    store.update({ ...run, state: 'accepted' })
    await nextTick()
    expect(wrapper.get('summary').text()).toContain('Backup')
    await wrapper.get('button').trigger('click')
    expect(desktop.backend.calls).toContainEqual({
      command: 'cancel_external_job',
      args: { id: 'job' },
    })
    store.update({ ...run, state: 'cancelled' })
    await nextTick()
    await wrapper.get('button').trigger('click')
    expect(wrapper.emitted('openHistory')).toHaveLength(1)
  } finally {
    wrapper.unmount()
    desktop.dispose()
  }
})
