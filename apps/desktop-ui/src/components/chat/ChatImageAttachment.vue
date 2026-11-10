<template>
  <div class="image-attachment" :class="`is-${effectiveSize}`">
    <button
      type="button"
      class="image-preview-btn"
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
      <span v-else class="image-status" role="status">{{
        hasFailed ? t('chat.imageUnavailable') : t('chat.imageProcessing')
      }}</span>
    </button>
    <IconButton
      v-if="removable"
      class="remove-image"
      size="xs"
      variant="neutral"
      @click="emit('remove')"
      :label="t('chat.removeImage')"
      icon="mdi:close"
    />
    <ImageViewerDialog
      :open="isViewerOpen"
      :src="url"
      :alt="image.name || t('chat.imageTitle')"
      @close="isViewerOpen = false"
    />
  </div>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from 'vue'

import { useChatScopeProfileId } from '../../composables/use-chat-scope'
import { useI18n } from '../../composables/use-i18n'
import { getChatImage } from '../../lib/chat/chat-image-storage'
import { changedChatFiles } from '../../lib/chat/chat-storage-changes'
import { desktopClient } from '../../lib/desktop/client'
import { clientLogger } from '../../lib/logger'
import IconButton from '../common/IconButton.vue'
import ImageViewerDialog from '../common/ImageViewerDialog.vue'
import { DESKTOP_EVENTS } from '@tyco/shared'
import type { ChatImage } from '@tyco/shared'

const props = defineProps<{
  image: ChatImage
  removable?: boolean
  /** A smaller thumbnail, to sit in one row with the text attachments */
  compact?: boolean
  /** Thumbnail size variant */
  size?: 'compact' | 'default' | 'large'
}>()
const emit = defineEmits<{ remove: []; loaded: [] }>()
const { t } = useI18n()
const profileId = useChatScopeProfileId()
const effectiveSize = computed(
  () => props.size ?? (props.compact ? 'compact' : 'default')
)
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
  display: inline-flex;
  width: fit-content;
}

.image-preview-btn {
  display: block;
  padding: 0;
  border: 1px solid var(--app-border);
  border-radius: var(--radius-md);
  background: var(--app-surface-raised);
  overflow: hidden;
  cursor: zoom-in;
  transition: border-color var(--transition-fast);
}

.image-preview-btn:disabled {
  cursor: default;
}

.image-preview-btn:hover:not(:disabled) {
  border-color: var(--app-border-strong);
}

.image-preview-btn:focus-visible {
  outline: var(--app-focus-outline-width) solid var(--color-primary);
  outline-offset: 2px;
}

.image-preview-btn img {
  display: block;
  width: auto;
  min-width: 3rem;
  max-width: 10rem;
  height: 6rem;
  object-fit: contain;
}

.image-attachment.is-compact .image-preview-btn img {
  min-width: 0;
  max-width: 6rem;
  height: 3rem;
}

.image-attachment.is-large .image-preview-btn img {
  min-width: 4.5rem;
  max-width: 15rem;
  height: 7.5rem;
}

.image-status {
  display: flex;
  align-items: center;
  justify-content: center;
  padding: var(--space-sm);
  font-size: var(--text-caption);
  color: var(--app-text-muted);
}

.image-attachment.is-large .image-status {
  min-width: 7.5rem;
  height: 7.5rem;
}

.remove-image {
  position: absolute;
  top: -0.4rem;
  right: -0.4rem;
  z-index: 1;
  --btn-color: var(--app-surface-raised);
  border-color: var(--app-border-strong);
  border-radius: 9999px;
  box-shadow: var(--app-shadow-sm);
  color: var(--color-base-content);
}
</style>
