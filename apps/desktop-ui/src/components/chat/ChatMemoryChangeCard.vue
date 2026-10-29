<template>
  <div class="memory-card">
    <div class="memory-card-header">
      <AppIcon icon="mdi:brain" size="md" class="memory-card-icon" />
      <span class="memory-card-title">
        {{ t('chatTools.memory.memoryUpdated', { file: fileName }) }}
      </span>
      <div class="memory-card-actions">
        <Button
          size="xs"
          variant="ghost"
          icon="mdi:undo"
          :disabled="isUndone || isUndoing"
          @click="handleUndo"
        >
          {{
            isUndone ? t('chatTools.memory.undone') : t('chatTools.memory.undo')
          }}
        </Button>
        <Button
          v-if="profileId"
          size="xs"
          variant="ghost"
          icon="mdi:open-in-new"
          @click="handleOpenProfile"
        >
          {{ t('chatTools.memory.open') }}
        </Button>
      </div>
    </div>

    <div v-if="lines.length" class="memory-card-diff">
      <div
        v-for="(line, idx) in lines"
        :key="idx"
        class="memory-diff-line"
        :class="`is-${line.kind}`"
      >
        <span class="diff-mark">{{ line.kind === 'added' ? '+' : '−' }}</span>
        <span class="diff-text">{{ line.text }}</span>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue'

import { useChatScope } from '../../composables/use-chat-scope'
import { useI18n } from '../../composables/use-i18n'
import useToast from '../../composables/use-toast'
import { appNavigation } from '../../navigation'
import { useIpcStore } from '../../stores/ipc'
import AppIcon from '../common/AppIcon.vue'
import Button from '../common/Button.vue'
import type { ChatMessagePart } from '@tyco/shared'

const props = defineProps<{
  call: Extract<ChatMessagePart, { type: 'tool-call' }>
  result?: Extract<ChatMessagePart, { type: 'tool-result' }>
}>()

const { t } = useI18n()
const { toastKey, toastError } = useToast()
const ipcStore = useIpcStore()
const chatScope = useChatScope()

const profileId = computed(() => chatScope.chat.profileId)
const chatId = computed(() => chatScope.chat.currentChatParams.id)

const inputData = computed(() => {
  const inp = props.call.input
  return inp && typeof inp === 'object' ? (inp as Record<string, unknown>) : {}
})

const fileName = computed(() => {
  const f = inputData.value.file
  return typeof f === 'string' && f.trim() ? f.trim() : 'core.md'
})

interface DiffLine {
  kind: 'added' | 'removed'
  text: string
}

const lines = computed<DiffLine[]>(() => {
  const tool = props.call.toolName
  const data = inputData.value

  if (tool === 'memory_add') {
    const fact = typeof data.fact === 'string' ? data.fact.trim() : ''
    return fact ? [{ kind: 'added', text: fact }] : []
  }

  if (tool === 'memory_replace') {
    const oldText = typeof data.old === 'string' ? data.old.trim() : ''
    const newText = typeof data.new === 'string' ? data.new.trim() : ''
    const res: DiffLine[] = []
    if (oldText) res.push({ kind: 'removed', text: oldText })
    if (newText) res.push({ kind: 'added', text: newText })
    return res
  }

  if (tool === 'memory_rewrite') {
    const content = typeof data.content === 'string' ? data.content.trim() : ''
    if (!content) return []
    const firstLines = content.split('\n').slice(0, 3)
    return firstLines.map((l) => ({ kind: 'added', text: l }))
  }

  return []
})

const isUndone = ref(false)
const isUndoing = ref(false)

async function handleUndo() {
  if (!profileId.value || isUndone.value || isUndoing.value) return
  isUndoing.value = true
  try {
    await ipcStore.call('undo_ai_profile_memory', {
      profileId: profileId.value,
      chatId: chatId.value,
      file: fileName.value,
    })
    await (
      chatScope.chat as unknown as { refreshProfile?: () => Promise<unknown> }
    ).refreshProfile?.()
    isUndone.value = true
    toastKey('chatTools.memory.undoSuccess', 'info')
  } catch (error) {
    toastError(error)
  } finally {
    isUndoing.value = false
  }
}

function handleOpenProfile() {
  if (profileId.value) {
    void appNavigation.goToConfig(`ai-profile:${profileId.value}`)
  }
}
</script>

<style scoped>
.memory-card {
  margin: var(--space-xs) 0;
  border: 1px solid var(--app-border-subtle);
  border-radius: var(--radius-md);
  background: var(--app-surface-raised);
  overflow: hidden;
  font-size: var(--text-caption);
}

.memory-card-header {
  display: flex;
  align-items: center;
  gap: var(--space-xs);
  padding: var(--space-xs) var(--space-md);
  border-bottom: 1px solid var(--app-border-subtle);
  background: var(--app-surface);
}

.memory-card-icon {
  color: var(--color-primary);
  flex-shrink: 0;
}

.memory-card-title {
  font-weight: 500;
  color: var(--app-text);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.memory-card-actions {
  display: flex;
  align-items: center;
  gap: var(--space-xs);
  margin-left: auto;
}

.memory-card-diff {
  padding: var(--space-xs) 0;
  font-family: var(--font-mono, monospace);
  font-size: var(--text-caption);
  background: var(--app-surface-raised);
}

.memory-diff-line {
  display: flex;
  align-items: flex-start;
  gap: var(--space-xs);
  padding: 2px var(--space-md);
  white-space: pre-wrap;
  word-break: break-word;
}

.diff-mark {
  flex-shrink: 0;
  font-weight: 600;
}

.memory-diff-line.is-added {
  color: var(--color-success);
  background: color-mix(in srgb, var(--color-success) 12%, transparent);
}

.memory-diff-line.is-removed {
  color: var(--color-error);
  background: color-mix(in srgb, var(--color-error) 12%, transparent);
}
</style>
