<template>
  <div
    ref="scroller"
    class="dialog-feed"
    :class="{ 'is-bubbles': isBubble }"
    role="log"
    aria-live="polite"
    :aria-label="t('dialog.feedLabel')"
    @scroll.passive="onScroll"
  >
    <DialogTurn
      v-for="turn in turns"
      :key="turn.id"
      :turn="turn"
      :is-bubble="isBubble"
      :text-display="textDisplay"
      :translation-lang="translationLang"
      @retry="(ids) => emit('retry', ids)"
    />
    <slot v-if="turns.length === 0" name="empty" />
  </div>
  <Button
    v-if="!isFollowing && turns.length > 0"
    class="dialog-feed-latest"
    size="sm"
    icon="mdi:arrow-down"
    @click="scrollToEnd"
    >{{ t('dialog.toLatest') }}</Button
  >
</template>

<script setup lang="ts">
import { nextTick, onMounted, ref, watch } from 'vue'

import { useI18n } from '../../composables/use-i18n'
import type { DialogTurn as Turn } from '../../lib/dialog/dialog-transcript'
import Button from '../common/Button.vue'
import DialogTurn from './DialogTurn.vue'
import type { DialogTextDisplay } from '@tyco/shared'

/** How close to the end still counts as being at the end, in pixels */
const FOLLOW_THRESHOLD_PX = 48

const props = defineProps<{
  turns: readonly Turn[]
  isBubble: boolean
  textDisplay: DialogTextDisplay
  translationLang?: string
}>()

const emit = defineEmits<{
  /** Translate these segments again */
  (e: 'retry', ids: string[]): void
}>()

const { t } = useI18n()
const scroller = ref<HTMLElement | null>(null)
/** Follows new speech until the user scrolls up to read */
const isFollowing = ref(true)

function onScroll() {
  const element = scroller.value
  if (!element) return
  isFollowing.value =
    element.scrollHeight - element.scrollTop - element.clientHeight <
    FOLLOW_THRESHOLD_PX
}

function scrollToEnd() {
  const element = scroller.value
  if (!element) return
  element.scrollTop = element.scrollHeight
  isFollowing.value = true
}

watch(
  () => props.turns,
  async () => {
    if (!isFollowing.value) return
    await nextTick()
    scrollToEnd()
  },
  { flush: 'post' }
)

onMounted(scrollToEnd)
</script>

<style scoped>
.dialog-feed {
  flex: 1 1 0%;
  min-height: 0;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
  gap: 0.75rem;
  padding: var(--space-md);
}

.dialog-feed-latest {
  position: absolute;
  bottom: var(--space-md);
  left: 50%;
  transform: translateX(-50%);
  box-shadow: var(--shadow-md, 0 2px 8px rgb(0 0 0 / 0.15));
}
</style>
