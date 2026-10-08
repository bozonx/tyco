<template>
  <div class="flex flex-col gap-6">
    <SettingsSection
      :title="t('settings.sectionMarkdown')"
      :description="t('settings.markdownHint')"
    >
      <FieldRow
        v-for="field in markdownFields"
        :key="field.name"
        :label="t(field.labelKey)"
      >
        <FieldSelect
          :value="userConfig.markdown[field.name]"
          :options="field.options"
          @update:value="userConfig.markdown[field.name] = $event"
        />
      </FieldRow>
      <FieldRow :label="t('settings.markdownIncrementListMarker')">
        <FieldCheckbox
          v-model:value="userConfig.markdown.incrementListMarker"
        />
      </FieldRow>
    </SettingsSection>

    <SettingsSection
      :title="t('settings.sectionMarkdownClean')"
      :description="t('settings.markdownCleanHint')"
    >
      <FieldRow :label="t('settings.markdownCleanBullet')">
        <FieldSelect
          v-model:value="userConfig.markdownClean.bullet"
          :options="cleanBulletOptions"
        />
      </FieldRow>
      <FieldRow :label="t('settings.markdownCleanCodeBlockIndent')">
        <FieldSelect
          v-model:value="userConfig.markdownClean.codeBlockIndent"
          :options="cleanCodeBlockIndentOptions"
        />
      </FieldRow>
      <FieldRow :label="t('settings.markdownCleanBlockquoteIndent')">
        <FieldSelect
          v-model:value="userConfig.markdownClean.blockquoteIndent"
          :options="cleanBlockquoteIndentOptions"
        />
      </FieldRow>
      <FieldRow :label="t('settings.markdownCleanLinkFormat')">
        <FieldSelect
          v-model:value="userConfig.markdownClean.linkFormat"
          :options="cleanLinkFormatOptions"
        />
      </FieldRow>
      <FieldRow :label="t('settings.markdownCleanKeepInlineCode')">
        <FieldCheckbox
          v-model:value="userConfig.markdownClean.keepInlineCode"
        />
      </FieldRow>
      <FieldRow :label="t('settings.markdownCleanKeepTaskCheckboxes')">
        <FieldCheckbox
          v-model:value="userConfig.markdownClean.keepTaskCheckboxes"
        />
      </FieldRow>
    </SettingsSection>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'

import { useI18n } from '../../composables/useI18n'
import FieldCheckbox from '../common/FieldCheckbox.vue'
import FieldRow from '../common/FieldRow.vue'
import FieldSelect from '../common/FieldSelect.vue'
import SettingsSection from '../common/SettingsSection.vue'
import {
  normalizeMarkdownCleanSettings,
  normalizeMarkdownSettings,
} from '@tyco/shared'

const props = defineProps<{ userConfig: Record<string, any> }>()

const { t } = useI18n()

if (!props.userConfig.markdown) {
  props.userConfig.markdown = normalizeMarkdownSettings(undefined)
}
if (!props.userConfig.markdownClean) {
  props.userConfig.markdownClean = normalizeMarkdownCleanSettings(undefined)
}

const markdownFields = computed(() => [
  {
    name: 'bullet',
    labelKey: 'settings.markdownBullet',
    options: ['-', '*', '+'].map((id) => ({ id, name: id })),
  },
  {
    name: 'emphasis',
    labelKey: 'settings.markdownEmphasis',
    options: ['*', '_'].map((id) => ({ id, name: id })),
  },
  {
    name: 'strong',
    labelKey: 'settings.markdownStrong',
    options: ['*', '_'].map((id) => ({ id, name: id.repeat(2) })),
  },
  {
    name: 'headingStyle',
    labelKey: 'settings.markdownHeadingStyle',
    options: [
      { id: 'atx', name: '# / ##' },
      { id: 'setext', name: '=== / ---' },
    ],
  },
])

const cleanBulletOptions = computed(() => [
  { id: '-', name: '-' },
  { id: '*', name: '*' },
  { id: 'none', name: t('settings.markdownCleanBulletNone') },
])

const cleanCodeBlockIndentOptions = computed(() => [
  { id: 'none', name: t('settings.markdownCleanIndentNone') },
  { id: '2spaces', name: t('settings.markdownCleanIndent2Spaces') },
  { id: '4spaces', name: t('settings.markdownCleanIndent4Spaces') },
  { id: 'tab', name: t('settings.markdownCleanIndentTab') },
])

const cleanBlockquoteIndentOptions = computed(() => [
  { id: 'none', name: t('settings.markdownCleanIndentNone') },
  { id: 'angle', name: t('settings.markdownCleanBlockquoteAngle') },
  { id: '2spaces', name: t('settings.markdownCleanIndent2Spaces') },
  { id: '4spaces', name: t('settings.markdownCleanIndent4Spaces') },
  { id: 'tab', name: t('settings.markdownCleanIndentTab') },
])

const cleanLinkFormatOptions = computed(() => [
  { id: 'text', name: t('settings.markdownCleanLinkText') },
  { id: 'textAndUrl', name: t('settings.markdownCleanLinkTextAndUrl') },
  { id: 'url', name: t('settings.markdownCleanLinkUrl') },
])
</script>
