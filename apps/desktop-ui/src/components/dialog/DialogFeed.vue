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
    <template
      v-for="item in items"
      :key="item.type === 'turn' ? item.turn.id : item.sessionBreak.id"
    >
      <DialogTurn
        v-if="item.type === 'turn'"
        :turn="item.turn"
        :is-bubble="isBubble"
        :is-translation-only="isTranslationOnly"
        :translation-lang="translationLang"
        @retry="(ids) => emit('retry', ids)"
      />
      <div v-else class="dialog-feed-break">
        <span class="dialog-feed-break-line" />
        <div class="dialog-feed-break-content">
          <span class="dialog-feed-break-badge">
            <AppIcon
              :icon="
                item.sessionBreak.isRecording
                  ? 'mdi:record-circle-outline'
                  : 'mdi:play-pause'
              "
              size="xs"
              :class="{ 'is-recording': item.sessionBreak.isRecording }"
            />
            <span>{{ breakLabel(item.sessionBreak) }}</span>
            <span class="dialog-feed-break-time">{{
              formatTime(item.sessionBreak.timestampMs)
            }}</span>
          </span>
          <DialogRecordingPlayer
            v-if="item.sessionBreak.recordingFile"
            :file="item.sessionBreak.recordingFile"
          />
        </div>
        <span class="dialog-feed-break-line" />
      </div>
    </template>
    <slot v-if="!hasTurns" name="empty" />
  </div>
  <Button
    v-if="!isFollowing && items.length > 0"
    class="dialog-feed-latest"
    size="sm"
    icon="mdi:arrow-down"
    @click="scrollToEnd"
    >{{ t('dialog.toLatest') }}</Button
  >
</template>

<script setup lang="ts">
import { computed, nextTick, onMounted, ref, watch } from 'vue'

import { useI18n } from '../../composables/use-i18n'
import { formatDialogClock } from '../../lib/dialog/dialog-export'
import type {
  DialogFeedItem,
  DialogSessionBreak,
} from '../../lib/dialog/dialog-transcript'
import AppIcon from '../common/AppIcon.vue'
import Button from '../common/Button.vue'
import DialogRecordingPlayer from './DialogRecordingPlayer.vue'
import DialogTurn from './DialogTurn.vue'

/** How close to the end still counts as being at the end, in pixels */
const FOLLOW_THRESHOLD_PX = 48

const props = defineProps<{
  items: readonly DialogFeedItem[]
  isBubble: boolean
  /** A translated turn shows its translation without the original */
  isTranslationOnly: boolean
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

const hasTurns = computed(() =>
  props.items.some((item) => item.type === 'turn')
)

function breakLabel(sessionBreak: DialogSessionBreak): string {
  if (sessionBreak.action === 'started') {
    return sessionBreak.isRecording
      ? t('dialog.sessionStartedRecording')
      : t('dialog.sessionStartedListening')
  }
  return sessionBreak.isRecording
    ? t('dialog.sessionResumedRecording')
    : t('dialog.sessionResumedListening')
}

function formatTime(timestampMs: number): string {
  return formatDialogClock(timestampMs)
}

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
  () => props.items,
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

.dialog-feed-break {
  display: flex;
  align-items: center;
  gap: var(--space-sm);
  margin: var(--space-xs) 0;
  color: var(--app-text-muted);
  font-size: var(--text-caption);
  user-select: none;
}

.dialog-feed-break-line {
  flex: 1;
  height: 1px;
  background-color: var(--app-border-subtle);
}

.dialog-feed-break-content {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: var(--space-xs);
  max-width: 100%;
}

.dialog-feed-break-badge {
  display: inline-flex;
  align-items: center;
  gap: var(--space-2xs);
  padding: 2px var(--space-xs);
  background-color: var(--app-surface-sunken);
  border-radius: var(--radius-full);
}

.dialog-feed-break-badge .is-recording {
  color: var(--color-error);
}

.dialog-feed-break-time {
  opacity: 0.75;
}

.dialog-feed-latest {
  position: absolute;
  bottom: var(--space-md);
  left: 50%;
  transform: translateX(-50%);
  box-shadow: var(--shadow-md, 0 2px 8px rgb(0 0 0 / 0.15));
}
</style>
