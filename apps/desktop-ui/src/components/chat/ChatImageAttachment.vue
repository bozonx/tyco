<template>
  <div class="image-attachment">
    <button
      type="button"
      :title="t('chat.viewImage')"
      :disabled="!url"
      @click="viewer?.showModal()"
    >
      <img
        v-if="url"
        :src="url"
        :alt="image.name || t('chat.imageTitle')"
        @load="emit('loaded')"
      />
      <span v-else role="status">{{
        failed ? t('chat.imageUnavailable') : t('chat.imageProcessing')
      }}</span>
    </button>
    <button
      v-if="removable"
      type="button"
      class="remove-image"
      :aria-label="t('chat.removeImage')"
      @click="emit('remove')"
    >
      <Icon icon="mdi:close" height="16" />
    </button>
    <dialog ref="viewer" class="image-viewer" @click="closeBackdrop">
      <button
        type="button"
        :aria-label="t('chat.closeImage')"
        @click="viewer?.close()"
      >
        <Icon icon="mdi:close" height="24" />
      </button>
      <img v-if="url" :src="url" :alt="image.name || t('chat.imageTitle')" />
    </dialog>
  </div>
</template>

<script setup lang="ts">
import { onBeforeUnmount, ref, watch } from 'vue'

import { useI18n } from '../../composables/useI18n'
import { getChatImage } from '../../lib/chat/chat-image-storage'
import { Icon } from '@iconify/vue'
import type { ChatImage } from '@tyco/shared'

const props = defineProps<{ image: ChatImage; removable?: boolean }>()
const emit = defineEmits<{ remove: []; loaded: [] }>()
const { t } = useI18n()
const url = ref('')
const failed = ref(false)
const viewer = ref<HTMLDialogElement | null>(null)
let version = 0
function release() {
  if (url.value) URL.revokeObjectURL(url.value)
  url.value = ''
}
watch(
  () => props.image.id,
  async (id) => {
    const current = ++version
    release()
    failed.value = false
    try {
      const bytes = await getChatImage(id)
      if (current === version)
        url.value = URL.createObjectURL(
          new Blob([bytes], { type: 'image/png' })
        )
    } catch {
      if (current === version) failed.value = true
    }
  },
  { immediate: true }
)
onBeforeUnmount(() => {
  version++
  release()
})
function closeBackdrop(event: MouseEvent) {
  if (event.target === viewer.value) viewer.value?.close()
}
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
.image-attachment span {
  display: block;
  padding: var(--space-sm);
  font-size: 0.75rem;
}
.remove-image {
  position: absolute;
  top: 0;
  right: 0;
  background: var(--app-surface);
  border-radius: 50%;
  padding: 0.2rem;
}
.image-viewer {
  max-width: 95vw;
  max-height: 95vh;
  padding: var(--space-md);
  background: var(--app-surface);
  border: 1px solid var(--app-border);
  border-radius: var(--radius-md);
}
.image-viewer::backdrop {
  background: rgb(0 0 0 / 70%);
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
