<template>
  <div class="note-preview">
    <p>{{ t('settings.fastNote.pathHint') }}</p>
    <p>{{ t('settings.fastNote.tokens') }}</p>
    <code>{{ dateTokens }}</code>
    <p>{{ t('settings.fastNote.textTokens') }}</p>
    <p>{{ t('settings.fastNote.collisionHint') }}</p>
    <FieldRow :label="t('settings.fastNote.sample')" vertical>
      <FieldTextArea v-model="sample" auto-resize />
    </FieldRow>
    <p v-for="issue in issues" :key="issue" role="alert" class="note-warning">
      {{ issueMessages[issue] }}
    </p>
    <p>{{ t('settings.fastNote.preview') }}</p>
    <code>{{ previewPath }}</code>
    <pre>{{ previewContent }}</pre>
  </div>
</template>
<script setup lang="ts">
import { computed, ref } from 'vue'

import { useI18n } from '../../composables/use-i18n'
import FieldRow from '../common/FieldRow.vue'
import FieldTextArea from '../common/FieldTextArea.vue'
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
const sample = ref('')
const now = new Date()
const dateTokens =
  '{YYYY} {YY} {MM} {DD} {HH} {mm} {ss} {WW} {GGGG} {zettel} {timestamp}'
const effective = computed(() => getEffectiveConfig(props.config))
const text = computed(
  () => sample.value.trim() || t('settings.fastNote.sampleText')
)
const issueMessages = computed(() => ({
  noNotesPath: t('settings.fastNote.errors.noNotesPath'),
  invalidNotesPath: t('settings.fastNote.errors.invalidNotesPath'),
  invalidSubfolder: t('settings.fastNote.errors.invalidSubfolder'),
  unknownTemplateToken: t('settings.fastNote.errors.unknownTemplateToken'),
  missingContentToken: t('settings.fastNote.errors.missingContentToken'),
  invalidFileName: t('settings.fastNote.errors.invalidFileName'),
}))
const issues = computed(() => validateFastNoteConfig(props.config))
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
