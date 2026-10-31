import { mount } from '@vue/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import {
  installFakeDesktop,
  type TestDesktop,
} from '../../test/install-fake-desktop'
import ConfigFields from './ConfigFields.vue'
import type { InputConfigItem } from '@/types'

vi.mock('../../composables/use-i18n', () => ({
  useI18n: () => ({ t: (key: string) => key }),
}))

const fields = (mode: string): InputConfigItem[] => [
  { type: 'text', name: 'folder', label: 'Folder', value: '/notes' },
  {
    type: 'select',
    name: 'mode',
    label: 'Mode',
    value: mode,
    defaultValue: 'a',
    options: [{ id: 'a' }, { id: 'b' }],
  },
  {
    type: 'text',
    name: 'template',
    label: 'Template',
    value: 'kept',
    visibleWhen: { field: 'mode', equals: ['b'] },
  },
]

describe('ConfigFields', () => {
  let desktop: TestDesktop
  beforeEach(() => {
    desktop = installFakeDesktop()
  })
  afterEach(() => desktop.dispose())

  it('hides a field for other values of its condition and keeps its value', async () => {
    const wrapper = mount(ConfigFields, { props: { config: fields('a') } })
    expect(wrapper.text()).not.toContain('Template')
    await wrapper.get('select').setValue('1')
    expect(wrapper.text()).toContain('Template')
    expect(wrapper.emitted('update:values')?.at(-1)).toEqual([
      { folder: '/notes', mode: 'b', template: 'kept' },
    ])
  })

  it('offers a folder picker only for the directory field', () => {
    expect(
      mount(ConfigFields, { props: { config: fields('a') } }).findAll('button')
    ).toHaveLength(0)
    expect(
      mount(ConfigFields, {
        props: { config: fields('a'), directoryField: 'folder' },
      }).findAll('button')
    ).toHaveLength(1)
  })
})
