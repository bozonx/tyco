import { flushPromises, mount } from '@vue/test-utils'
import { expect, it, vi } from 'vitest'
import { i18n } from '../../lib/i18n'
import { loadFakeDesktop } from '../../test/install-fake-desktop'
import ListenSourcePicker from './ListenSourcePicker.vue'

vi.mock('../common/DropdownMenu.vue', () => ({
  default: { name: 'DropdownMenu', template: '<button />' },
}))

it('stops a watch that finishes starting after the picker is destroyed', async () => {
  const desktop = await loadFakeDesktop({}, 'quick')
  let release!: (id: number) => void
  desktop.backend.handle(
    'watch_audio_apps',
    () =>
      new Promise<number>((resolve) => {
        release = resolve
      })
  )
  desktop.backend.handle('unwatch_audio_apps', () => undefined)
  const wrapper = mount(ListenSourcePicker, {
    props: { source: { kind: 'systemMix' } },
    global: { plugins: [i18n, desktop.pinia] },
  })
  try {
    wrapper
      .findComponent({ name: 'DropdownMenu' })
      .vm.$emit('open-change', true)
    await flushPromises()
    wrapper.unmount()
    release(7)
    await flushPromises()
    expect(desktop.backend.callsOf('unwatch_audio_apps')).toEqual([
      { watchId: 7 },
    ])
  } finally {
    wrapper.unmount()
    desktop.dispose()
  }
})
