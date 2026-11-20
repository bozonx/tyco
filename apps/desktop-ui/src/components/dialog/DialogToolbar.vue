<template>
  <div class="dialog-toolbar">
    <div class="dialog-toolbar-group">
      <Button
        v-if="!dialog.isActive"
        variant="primary"
        size="sm"
        icon="mdi:record-circle-outline"
        @click="dialog.start()"
        >{{ t('dialog.start') }}</Button
      >
      <Button
        v-else
        size="sm"
        icon="mdi:stop"
        :loading="dialog.status === 'starting'"
        @click="dialog.stop()"
        >{{ t('dialog.stop') }}</Button
      >
      <SegmentedControl
        :model-value="dialog.config.source"
        size="sm"
        :label="t('dialog.source')"
        :options="sourceOptions"
        :disabled="dialog.isActive"
        @update:model-value="(source) => dialog.updateConfig({ source })"
      />
      <DialogLevel
        v-if="dialog.isActive && dialog.hasMicrophone"
        icon="mdi:microphone"
        :label="t('dialog.levelMe')"
        :level="dialog.levels.me"
        :is-off="dialog.channelStatus.me === 'failed'"
      />
      <DialogLevel
        v-if="dialog.isActive"
        icon="mdi:volume-high"
        :label="t('dialog.levelRemote')"
        :level="dialog.levels.remote"
        :is-off="dialog.channelStatus.remote === 'failed'"
      />
      <span v-if="channelNotice" class="dialog-toolbar-status" role="status">
        {{ channelNotice }}
      </span>
    </div>
    <div class="dialog-toolbar-group">
      <FieldSelect
        :model-value="dialog.config.translationTargetLanguage"
        size="sm"
        :title="t('dialog.translationLanguage')"
        :aria-label="t('dialog.translationLanguage')"
        :options="languageOptions"
        @update:model-value="
          (language) =>
            dialog.updateConfig({
              translationTargetLanguage: String(language ?? ''),
            })
        "
      />
      <SegmentedControl
        v-if="dialog.config.translationTargetLanguage"
        :model-value="dialog.config.textDisplay"
        size="sm"
        :label="t('dialog.textDisplay')"
        :options="displayOptions"
        @update:model-value="
          (textDisplay) => dialog.updateConfig({ textDisplay })
        "
      />
      <IconButton
        icon="mdi:content-copy"
        :label="t('dialog.copy')"
        :disabled="isEmpty"
        @click="dialog.copyTranscript()"
      />
      <IconButton
        icon="mdi:lightning-bolt-outline"
        :label="t('dialog.toActionMenu')"
        :disabled="isEmpty"
        @click="dialog.sendToActionMenu()"
      />
      <IconButton
        icon="mdi:delete-sweep-outline"
        :label="t('dialog.clear')"
        :disabled="isEmpty"
        @click="dialog.clear()"
      />
      <IconButton
        icon="mdi:subtitles-outline"
        :label="t('dialog.collapse')"
        @click="dialog.enterCompact()"
      />
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'

import { useI18n } from '../../composables/use-i18n'
import { dialogLanguageOptions } from '../../lib/dialog/dialog-languages'
import { translationLanguageLabel } from '../../lib/translation/translation-languages'
import type { ControlOption } from '../../lib/ui/control-option'
import { useDesktopStore } from '../../stores/desktop'
import { useDialogStore } from '../../stores/dialog'
import Button from '../common/Button.vue'
import FieldSelect from '../common/FieldSelect.vue'
import IconButton from '../common/IconButton.vue'
import SegmentedControl from '../common/SegmentedControl.vue'
import DialogLevel from './DialogLevel.vue'
import type { DialogSource, DialogTextDisplay } from '@tyco/shared'

const dialog = useDialogStore()
const desktopStore = useDesktopStore()
const { t, locale } = useI18n()

const isEmpty = computed(() => dialog.segments.length === 0)

const sourceOptions = computed<ControlOption<DialogSource>[]>(() => [
  {
    id: 'microphoneAndSystem',
    name: t('dialog.sourceMicrophoneAndSystem'),
    icon: 'mdi:account-voice',
  },
  { id: 'system', name: t('dialog.sourceSystem'), icon: 'mdi:volume-high' },
])

const displayOptions = computed<ControlOption<DialogTextDisplay>[]>(() => [
  { id: 'translation', name: t('dialog.displayTranslation') },
  { id: 'original', name: t('dialog.displayOriginal') },
  { id: 'both', name: t('dialog.displayBoth') },
])

const languageOptions = computed(() =>
  dialogLanguageOptions({
    targetLanguages: desktopStore.userConfig.translation?.targetLanguages,
    current: dialog.config.translationTargetLanguage,
    offLabel: t('dialog.noTranslation'),
    labelOf: (id) => translationLanguageLabel(id, String(locale.value)),
  })
)

const channelNotice = computed(() => {
  const statuses = Object.values(dialog.channelStatus)
  if (statuses.includes('reconnecting')) return t('dialog.reconnecting')
  if (statuses.includes('connecting')) return t('dialog.connecting')
  return ''
})
</script>

<style scoped>
.dialog-toolbar {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-sm);
  padding: var(--space-sm) var(--space-md);
  border-bottom: 1px solid var(--app-border-subtle);
}

.dialog-toolbar-group {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--space-sm);
}

.dialog-toolbar-status {
  font-size: var(--text-small, 0.8125rem);
  color: var(--app-text-muted);
}
</style>
