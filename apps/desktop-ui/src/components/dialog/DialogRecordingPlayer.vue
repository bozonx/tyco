<template>
  <div class="dialog-recording-player">
    <HistoryFilePlayer :file="recordingFileItem" />
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'

import { useI18n } from '../../composables/use-i18n'
import { useSoundCaptureActivity } from '../../composables/use-sound-capture-activity'
import { convertFileSrc } from '../../lib/desktop/window'
import type { HistoryListItemFile } from '../../lib/history/history-list-types'
import { loadRecordingMediaSource } from '../../lib/history/recording-media-url'
import { useDialogStore } from '../../stores/dialog'
import { useIpcStore } from '../../stores/ipc'
import HistoryFilePlayer from '../history/HistoryFilePlayer.vue'

const props = withDefaults(
  defineProps<{
    dialogId: string
    file: string
    isMissing?: boolean
    isIncomplete?: boolean
  }>(),
  { isMissing: false, isIncomplete: false }
)

const { t } = useI18n()
const dialog = useDialogStore()
const ipcStore = useIpcStore()
const isSoundCaptured = useSoundCaptureActivity()

const isPlayDisabled = computed(() => dialog.isActive || isSoundCaptured.value)

const recordingFileItem = computed<HistoryListItemFile>(() => ({
  name: props.file,
  isMissing: props.isMissing,
  missingLabel: t('history.recordingNotFound'),
  ...(props.isIncomplete && { note: t('history.recordingIncomplete') }),
  playback: {
    source: async () => {
      const readRecording = async (
        dialogId: string,
        file: string
      ): Promise<ArrayBuffer> => {
        const result = await ipcStore.call('read_dialog_recording', {
          dialogId,
          file,
        })
        if (!result.success || !result.result) {
          throw new Error(result.error ?? 'Could not read recording')
        }
        return result.result
      }
      return loadRecordingMediaSource(
        props.dialogId,
        props.file,
        convertFileSrc,
        readRecording
      )
    },
    playTitle: t('history.playRecording'),
    stopTitle: t('history.stopRecording'),
    speedTitle: t('history.playbackSpeed'),
    disabledTitle: isPlayDisabled.value
      ? t('history.playRecordingWhileCapturing')
      : undefined,
    unavailableLabel: t('history.recordingUnplayable'),
  },
}))
</script>

<style scoped>
.dialog-recording-player {
  display: inline-flex;
  align-items: center;
  gap: var(--space-2xs);
  max-width: 100%;
}
</style>
