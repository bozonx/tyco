import { mount } from '@vue/test-utils'
import { describe, expect, it, vi } from 'vitest'
import { createI18n } from 'vue-i18n'
import { withConfigFieldValue } from '@tyco/plugin-sdk'
import pluginIndex from '@tyco/plugin-fast-note'
import { FAST_NOTE_PRESETS } from '@tyco/plugin-fast-note/templates'
import { scopeConfigFields } from '../../lib/plugins/plugin-resources'
import FastNoteSettings from './FastNoteSettings.vue'
import FastNotePreview from './FastNotePreview.vue'
import FastNoteDirectoryPicker from './FastNoteDirectoryPicker.vue'
import InfoTooltip from '../common/InfoTooltip.vue'
import en from '../../lib/i18n/locales/en_US.json'
import ru from '../../lib/i18n/locales/ru_RU.json'
import es from '../../lib/i18n/locales/es_AR.json'
import tr from '../../lib/i18n/locales/tr_TR.json'

const { pickDirectory } = vi.hoisted(() => ({ pickDirectory: vi.fn() }))
vi.mock('../../stores/ipc', () => ({
  useIpcStore: () => ({ callOrNotify: pickDirectory }),
}))
vi.mock('../../composables/use-i18n', () => ({
  useI18n: () => ({
    t: (key: string) =>
      key === 'settings.fastNote.sampleText' ? 'First\nSecond' : key,
  }),
}))

const fields = () =>
  scopeConfigFields('FastNote', pluginIndex().defaultConfig!.fields).map(
    (field) =>
      withConfigFieldValue(
        field,
        field.name === 'pathToNotes' ? '/notes' : field.defaultValue
      )
  )

describe('FastNote settings', () => {
  it('applies a template only on request and preserves the notes root and clear setting', async () => {
    const wrapper = mount(FastNoteSettings, { props: { fields: fields() } })
    await wrapper.get('select').setValue('2')
    expect(wrapper.emitted('update')).toBeUndefined()
    await wrapper.get('button').trigger('click')
    expect(wrapper.emitted('update')?.at(-1)).toEqual([
      {
        ...FAST_NOTE_PRESETS.obsidian_daily,
        pathToNotes: '/notes',
        preset: 'custom',
        clearInputAfterSave: false,
      },
    ])
  })
  it('hides inactive folder templates and retains their saved value', async () => {
    const config = fields().map((field) =>
      field.name === 'customSubfolderTemplate'
        ? withConfigFieldValue(field, 'inbox/{YYYY}')
        : field
    )
    const wrapper = mount(FastNoteSettings, { props: { fields: config } })
    expect(
      wrapper
        .findAll('input')
        .some(
          (input) =>
            (input.element as HTMLInputElement).value === 'inbox/{YYYY}'
        )
    ).toBe(false)
    await wrapper.setProps({
      fields: config.map((field) =>
        field.name === 'folderPreset'
          ? withConfigFieldValue(field, 'custom')
          : field
      ),
    })
    expect(
      wrapper
        .findAll('input')
        .some(
          (input) =>
            (input.element as HTMLInputElement).value === 'inbox/{YYYY}'
        )
    ).toBe(true)
  })
  it('uses the directory picker without writing notes', async () => {
    pickDirectory.mockResolvedValue({ success: true, result: '/new-notes' })
    const wrapper = mount(FastNoteSettings, { props: { fields: fields() } })
    await wrapper
      .findComponent(FastNoteDirectoryPicker)
      .get('button')
      .trigger('click')
    expect(pickDirectory).toHaveBeenCalledWith('pick_directory')
    expect(wrapper.emitted('update')?.at(-1)?.[0]).toMatchObject({
      pathToNotes: '/new-notes',
    })
  })
  it('renders info tooltips for notes folder and template fields', () => {
    const config = fields().map((field) =>
      field.name === 'folderPreset'
        ? withConfigFieldValue(field, 'custom')
        : field
    )
    const wrapper = mount(FastNoteSettings, { props: { fields: config } })
    const tooltips = wrapper.findAllComponents(InfoTooltip)
    const texts = tooltips.map((tip) => tip.props('text'))
    expect(texts).toContain('settings.fastNote.pathHint')
    expect(
      texts.some((text) => String(text).includes('customSubfolderTemplateInfo'))
    ).toBe(true)
    expect(
      texts.some((text) => String(text).includes('fileNameTemplateInfo'))
    ).toBe(true)
    expect(
      texts.some((text) => String(text).includes('contentTemplateInfo'))
    ).toBe(true)
  })
  it('previews multiline journal content with localized sample text and reports missing content tokens', async () => {
    const wrapper = mount(FastNotePreview, {
      props: { config: { pathToNotes: '/notes', preset: 'logseq_journal' } },
    })
    expect(wrapper.find('textarea').exists()).toBe(false)
    expect(wrapper.get('pre').text()).toBe('- First\n  Second')
    expect(wrapper.text()).toContain('/notes/journals/')
    await wrapper.setProps({
      config: { pathToNotes: '/notes', contentTemplate: '# {title}' },
    })
    expect(wrapper.get('[role="alert"]').text()).toBe(
      'settings.fastNote.errors.missingContentToken'
    )
  })
  it('renders literal template tokens in every locale without interpolation errors', () => {
    for (const messages of [en, ru, es, tr]) {
      const i18n = createI18n({
        legacy: false,
        locale: 'test',
        fallbackLocale: false,
        messages: { test: messages },
      })
      expect(
        i18n.global.t('settings.fastNote.errors.missingContentToken')
      ).toContain('{content}')
    }
  })
})
