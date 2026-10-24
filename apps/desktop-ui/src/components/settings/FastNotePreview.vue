<template>
  <div class="note-preview">
    <p v-for="issue in issues" :key="issue" role="alert" class="note-warning">
      {{ issueMessages[issue] }}
    </p>
    <p>{{ t('settings.fastNote.preview') }}</p>
    <code>{{ previewPath }}</code>
    <pre>{{ previewContent }}</pre>
  </div>
</template>
<script setup lang="ts">
import { computed } from 'vue'

import { useI18n } from '../../composables/use-i18n'
import {
  type FastNoteConfig,
  getEffectiveConfig,
  resolveNoteContent,
  resolveNoteDir,
  resolveNoteFileName,
  validateFastNoteConfig,
} from '@tyco/plugin-fast-note/templates'

const props = defineProps<{ config: Partial<FastNoteConfig> }>()
const { t } = useI18n()
const now = new Date()
const effective = computed(() => getEffectiveConfig(props.config))
const text = computed(() => t('settings.fastNote.sampleText'))
const issueMessages = computed(() => ({
  invalidNotesPath: t('settings.fastNote.errors.invalidNotesPath'),
  invalidSubfolder: t('settings.fastNote.errors.invalidSubfolder'),
  unknownTemplateToken: t('settings.fastNote.errors.unknownTemplateToken'),
  missingContentToken: t('settings.fastNote.errors.missingContentToken'),
  invalidFileName: t('settings.fastNote.errors.invalidFileName'),
}))
const issues = computed(() =>
  validateFastNoteConfig(props.config).filter(
    (issue): issue is keyof typeof issueMessages.value =>
      issue !== 'noNotesPath'
  )
)
const previewPath = computed(() => {
  const settings = effective.value
  const dir = resolveNoteDir(
    props.config.pathToNotes || '',
    settings.folderPreset,
    settings.customSubfolderTemplate,
    now
  )
  return `${dir}${dir.endsWith('/') ? '' : '/'}${resolveNoteFileName(settings.fileNameTemplate, now, text.value)}`
})
const previewContent = computed(() =>
  resolveNoteContent(
    effective.value.saveMode,
    effective.value.contentTemplate,
    text.value,
    now
  )
)
</script>
<style scoped>
.note-preview {
  padding: var(--space-lg);
  display: flex;
  flex-direction: column;
  gap: var(--space-sm);
  font-size: var(--text-caption);
}
.note-preview code,
.note-preview pre {
  white-space: pre-wrap;
  overflow-wrap: anywhere;
}
.note-warning {
  color: var(--color-error);
}
</style>
