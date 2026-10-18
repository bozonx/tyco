import { mount } from '@vue/test-utils'
import { nextTick } from 'vue'
import { expect, it } from 'vitest'
import AppIcon from './AppIcon.vue'
import { pluginIcons } from '../../lib/plugins/plugin-icons'

it('updates plugin SVGs after replacement and removes them after disposal', async () => {
  const prefix = 'tyco-ptest'
  pluginIcons.register({
    prefix,
    icons: { test: { body: '<path d="M0 0h1v1z"/>' } },
  })
  const wrapper = mount(AppIcon, {
    props: { icon: `${prefix}:test`, size: 'lg' },
    attrs: { 'aria-hidden': true },
  })
  await nextTick()
  expect(wrapper.find('path').exists()).toBe(true)
  expect(wrapper.find('svg').attributes('height')).toBe('1.125rem')
  pluginIcons.register({
    prefix,
    icons: { test: { body: '<circle cx="5" cy="5" r="2"/>' } },
  })
  await nextTick()
  expect(wrapper.find('path').exists()).toBe(false)
  expect(wrapper.find('circle').exists()).toBe(true)
  pluginIcons.remove(prefix)
  await nextTick()
  expect(wrapper.find('svg').exists()).toBe(false)
  wrapper.unmount()
})
