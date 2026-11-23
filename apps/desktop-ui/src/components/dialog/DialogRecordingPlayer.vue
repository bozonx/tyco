<template>
  <HistoryFilePlayer :file="recordingFileItem" />
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

const props = defineProps<{ file: string }>()

const { t } = useI18n()
const dialog = useDialogStore()
const ipcStore = useIpcStore()
const isSoundCaptured = useSoundCaptureActivity()

const isPlayDisabled = computed(() => dialog.isActive || isSoundCaptured.value)

const recordingFileItem = computed<HistoryListItemFile>(() => ({
  name: props.file,
  isMissing: false,
  missingLabel: t('history.recordingNotFound'),
  playback: {
    source: async () => {
      const readRecording = async (file: string): Promise<ArrayBuffer> => {
        const result = await ipcStore.call('read_dialog_recording', { file })
        if (!result.success || !result.result) {
          throw new Error(result.error ?? 'Could not read recording')
        }
        return result.result
      }
      return loadRecordingMediaSource(props.file, convertFileSrc, readRecording)
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
