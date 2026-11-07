<template>
  <div class="settings-stack">
    <SettingsSection
      :title="t('settings.sectionMarkdown')"
      :info="t('settings.markdownHint')"
    >
      <FieldRow
        v-for="field in markdownFields"
        :key="field.name"
        :label="t(field.labelKey)"
      >
        <FieldSelect
          :model-value="markdown[field.name]"
          :options="field.options"
          @update:model-value="updateMarkdown(field.name, $event)"
        />
      </FieldRow>
      <FieldRow
        :label="t('settings.markdownIncrementListMarker')"
        :info="t('settings.markdownIncrementListMarkerInfo')"
      >
        <FieldSwitch v-model="markdown.isListMarkerIncremented" />
      </FieldRow>
    </SettingsSection>

    <SettingsSection
      :title="t('settings.sectionMarkdownClean')"
      :info="t('settings.markdownCleanHint')"
    >
      <FieldRow :label="t('settings.markdownCleanBullet')">
        <FieldSelect
          v-model="markdownStrip.bullet"
          :options="cleanBulletOptions"
        />
      </FieldRow>
      <FieldRow :label="t('settings.markdownCleanCodeBlockIndent')">
        <FieldSelect
          v-model="markdownStrip.codeBlockIndent"
          :options="cleanCodeBlockIndentOptions"
        />
      </FieldRow>
      <FieldRow :label="t('settings.markdownCleanBlockquoteIndent')">
        <FieldSelect
          v-model="markdownStrip.blockquoteIndent"
          :options="cleanBlockquoteIndentOptions"
        />
      </FieldRow>
      <FieldRow :label="t('settings.markdownCleanLinkFormat')">
        <FieldSelect
          v-model="markdownStrip.linkFormat"
          :options="cleanLinkFormatOptions"
        />
      </FieldRow>
      <FieldRow :label="t('settings.markdownCleanImageFormat')">
        <FieldSelect
          v-model="markdownStrip.imageFormat"
          :options="cleanImageFormatOptions"
        />
      </FieldRow>
      <FieldRow :label="t('settings.markdownCleanKeepInlineCode')">
        <FieldSwitch v-model="markdownStrip.hasInlineCode" />
      </FieldRow>
      <FieldRow :label="t('settings.markdownCleanKeepHorizontalRules')">
        <FieldSwitch v-model="markdownStrip.hasThematicBreaks" />
      </FieldRow>
      <FieldRow :label="t('settings.markdownCleanKeepTaskCheckboxes')">
        <FieldSwitch v-model="markdownStrip.hasTaskCheckboxes" />
      </FieldRow>
    </SettingsSection>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'

import { useI18n } from '../../composables/use-i18n'
import { useSettingsContext } from '../../composables/use-settings-context'
import FieldRow from '../common/FieldRow.vue'
import FieldSelect from '../common/FieldSelect.vue'
import FieldSwitch from '../common/FieldSwitch.vue'
import SettingsSection from './SettingsSection.vue'
import { type MarkdownFormatSettings, normalizeConfigValue } from '@tyco/shared'

const { t } = useI18n()
const { draft } = useSettingsContext()

const markdown = computed(() => draft.value.markdown.format)
const markdownStrip = computed(() => draft.value.markdown.strip)

function updateMarkdown(
  name: keyof Omit<MarkdownFormatSettings, 'isListMarkerIncremented'>,
  value: unknown
) {
  Object.assign(
    markdown.value,
    normalizeConfigValue<MarkdownFormatSettings>('markdown.format', {
      ...markdown.value,
      [name]: value,
    })
  )
}

const markdownFields = computed(() => [
  {
    name: 'bullet' as const,
    labelKey: 'settings.markdownBullet',
    options: ['-', '*', '+'].map((id) => ({ id, name: id })),
  },
  {
    name: 'emphasis' as const,
    labelKey: 'settings.markdownEmphasis',
    options: ['*', '_'].map((id) => ({ id, name: id })),
  },
  {
    name: 'strong' as const,
    labelKey: 'settings.markdownStrong',
    options: ['*', '_'].map((id) => ({ id, name: id.repeat(2) })),
  },
])

const cleanBulletOptions = computed(() => [
  { id: '-', name: '-' },
  { id: '*', name: '*' },
  { id: 'none', name: t('settings.markdownCleanBulletNone') },
])

const cleanCodeBlockIndentOptions = computed(() => [
  { id: 'none', name: t('settings.markdownCleanIndentNone') },
  { id: 'twoSpaces', name: t('settings.markdownCleanIndent2Spaces') },
  { id: 'fourSpaces', name: t('settings.markdownCleanIndent4Spaces') },
  { id: 'tab', name: t('settings.markdownCleanIndentTab') },
])

const cleanBlockquoteIndentOptions = computed(() => [
  { id: 'none', name: t('settings.markdownCleanIndentNone') },
  { id: 'angle', name: t('settings.markdownCleanBlockquoteAngle') },
  { id: 'twoSpaces', name: t('settings.markdownCleanIndent2Spaces') },
  { id: 'fourSpaces', name: t('settings.markdownCleanIndent4Spaces') },
  { id: 'tab', name: t('settings.markdownCleanIndentTab') },
])

const cleanLinkFormatOptions = computed(() => [
  { id: 'text', name: t('settings.markdownCleanLinkText') },
  { id: 'textAndUrl', name: t('settings.markdownCleanLinkTextAndUrl') },
  { id: 'url', name: t('settings.markdownCleanLinkUrl') },
])

const cleanImageFormatOptions = computed(() => [
  { id: 'alt', name: t('settings.markdownCleanImageAlt') },
  { id: 'altAndUrl', name: t('settings.markdownCleanImageAltAndUrl') },
  { id: 'url', name: t('settings.markdownCleanImageUrl') },
  { id: 'none', name: t('settings.markdownCleanImageNone') },
])
</script>
