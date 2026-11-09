<template>
  <div class="image-attachment" :class="{ 'is-compact': compact }">
    <button
      type="button"
      :title="hasFailed ? t('chat.imageError') : t('chat.viewImage')"
      :disabled="!url && !hasFailed"
      @click="hasFailed ? load() : (isViewerOpen = true)"
    >
      <img
        v-if="url"
        :src="url"
        :alt="image.name || t('chat.imageTitle')"
        @load="emit('loaded')"
      />
      <span v-else role="status">{{
        hasFailed ? t('chat.imageUnavailable') : t('chat.imageProcessing')
      }}</span>
    </button>
    <IconButton
      v-if="removable"
      class="remove-image"
      @click="emit('remove')"
      :label="t('chat.removeImage')"
      icon="mdi:close"
    />
    <BaseDialog
      size="content"
      :open="isViewerOpen"
      :label="image.name || t('chat.imageTitle')"
      class="image-viewer"
      @close="isViewerOpen = false"
    >
      <IconButton
        @click="isViewerOpen = false"
        :label="t('chat.closeImage')"
        icon="mdi:close"
      />
      <img v-if="url" :src="url" :alt="image.name || t('chat.imageTitle')" />
    </BaseDialog>
  </div>
</template>

<script setup lang="ts">
import { onBeforeUnmount, ref, watch } from 'vue'

import { useChatScopeProfileId } from '../../composables/use-chat-scope'
import { useI18n } from '../../composables/use-i18n'
import { getChatImage } from '../../lib/chat/chat-image-storage'
import { changedChatFiles } from '../../lib/chat/chat-storage-changes'
import { desktopClient } from '../../lib/desktop/client'
import { clientLogger } from '../../lib/logger'
import BaseDialog from '../common/BaseDialog.vue'
import IconButton from '../common/IconButton.vue'
import { DESKTOP_EVENTS } from '@tyco/shared'
import type { ChatImage } from '@tyco/shared'

const props = defineProps<{
  image: ChatImage
  removable?: boolean
  /** A smaller thumbnail, to sit in one row with the text attachments */
  compact?: boolean
}>()
const emit = defineEmits<{ remove: []; loaded: [] }>()
const { t } = useI18n()
const profileId = useChatScopeProfileId()
const url = ref('')
const hasFailed = ref(false)
const isViewerOpen = ref(false)
let version = 0
function release() {
  if (url.value) URL.revokeObjectURL(url.value)
  url.value = ''
}
async function load() {
  const current = ++version
  release()
  hasFailed.value = false
  try {
    const bytes = await getChatImage(props.image.id, profileId)
    if (current === version)
      url.value = URL.createObjectURL(
        new Blob([bytes], { type: props.image.mediaType })
      )
  } catch {
    if (current === version) hasFailed.value = true
  }
}
watch(() => props.image.id, load, { immediate: true })
let disposed = false
let stopListening: (() => void) | undefined
if (desktopClient.isAvailable()) {
  void desktopClient
    .listen(DESKTOP_EVENTS.STORAGE_CHANGED, (event) => {
      if (
        !disposed &&
        !url.value &&
        changedChatFiles(event, profileId ?? null).some((file) =>
          file.startsWith(`images/${props.image.id}.`)
        )
      )
        void load()
    })
    .then((stop) => {
      if (disposed) stop()
      else stopListening = stop
    })
    .catch((error) =>
      clientLogger.error('Could not follow chat images', error, 'chat')
    )
}
onBeforeUnmount(() => {
  disposed = true
  stopListening?.()
  version++
  release()
})
</script>

<style scoped>
.image-attachment {
  position: relative;
  max-width: 10rem;
}
.image-attachment > button:first-child {
  border: 1px solid var(--app-border);
  border-radius: var(--radius-md);
  overflow: hidden;
}
.image-attachment > button img {
  width: 8rem;
  height: 6rem;
  object-fit: contain;
}
.image-attachment.is-compact > button img {
  width: auto;
  max-width: 6rem;
  height: 3rem;
}
.image-attachment span {
  display: block;
  padding: var(--space-sm);
  font-size: var(--text-caption);
}
.remove-image {
  position: absolute;
  top: 0;
  right: 0;
  background: var(--app-surface);
  border-radius: 50%;
  padding: 0.2rem;
}
.image-viewer > button {
  display: block;
  margin-left: auto;
}
.image-viewer img {
  max-width: 85vw;
  max-height: 80vh;
  object-fit: contain;
}
</style>
