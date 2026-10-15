<template>
  <div class="flex flex-col gap-6">
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
        <FieldCheckbox v-model="markdown.incrementListMarker" />
      </FieldRow>
    </SettingsSection>

    <SettingsSection
      :title="t('settings.sectionMarkdownClean')"
      :info="t('settings.markdownCleanHint')"
    >
      <FieldRow :label="t('settings.markdownCleanBullet')">
        <FieldSelect
          v-model="markdownClean.bullet"
          :options="cleanBulletOptions"
        />
      </FieldRow>
      <FieldRow :label="t('settings.markdownCleanCodeBlockIndent')">
        <FieldSelect
          v-model="markdownClean.codeBlockIndent"
          :options="cleanCodeBlockIndentOptions"
        />
      </FieldRow>
      <FieldRow :label="t('settings.markdownCleanBlockquoteIndent')">
        <FieldSelect
          v-model="markdownClean.blockquoteIndent"
          :options="cleanBlockquoteIndentOptions"
        />
      </FieldRow>
      <FieldRow :label="t('settings.markdownCleanLinkFormat')">
        <FieldSelect
          v-model="markdownClean.linkFormat"
          :options="cleanLinkFormatOptions"
        />
      </FieldRow>
      <FieldRow :label="t('settings.markdownCleanImageFormat')">
        <FieldSelect
          v-model="markdownClean.imageFormat"
          :options="cleanImageFormatOptions"
        />
      </FieldRow>
      <FieldRow :label="t('settings.markdownCleanKeepInlineCode')">
        <FieldCheckbox v-model="markdownClean.keepInlineCode" />
      </FieldRow>
      <FieldRow :label="t('settings.markdownCleanKeepHorizontalRules')">
        <FieldCheckbox v-model="markdownClean.keepThematicBreaks" />
      </FieldRow>
      <FieldRow :label="t('settings.markdownCleanKeepTaskCheckboxes')">
        <FieldCheckbox v-model="markdownClean.keepTaskCheckboxes" />
      </FieldRow>
    </SettingsSection>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'

import { useI18n } from '../../composables/use-i18n'
import FieldCheckbox from '../common/FieldCheckbox.vue'
import FieldRow from '../common/FieldRow.vue'
import FieldSelect from '../common/FieldSelect.vue'
import SettingsSection from '../common/SettingsSection.vue'
import type { MarkdownSettings, UserConfig } from '@tyco/shared'
import { normalizeMarkdownSettings } from '@tyco/shared'

const props = defineProps<{
  userConfig: Pick<UserConfig, 'markdown' | 'markdownClean'>
}>()

const { t } = useI18n()

const markdown = computed(() => props.userConfig.markdown)
const markdownClean = computed(() => props.userConfig.markdownClean)

function updateMarkdown(
  name: keyof Omit<MarkdownSettings, 'incrementListMarker'>,
  value: unknown
) {
  Object.assign(
    markdown.value,
    normalizeMarkdownSettings({ ...markdown.value, [name]: value })
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

const cleanImageFormatOptions = computed(() => [
  { id: 'alt', name: t('settings.markdownCleanImageAlt') },
  { id: 'altAndUrl', name: t('settings.markdownCleanImageAltAndUrl') },
  { id: 'url', name: t('settings.markdownCleanImageUrl') },
  { id: 'none', name: t('settings.markdownCleanImageNone') },
])
</script>
