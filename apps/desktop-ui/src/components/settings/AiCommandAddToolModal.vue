<template>
  <BaseDialog
    class="add-tool-dialog"
    :open="open"
    :labelledby="titleId"
    @close="close"
  >
    <div class="add-tool-modal">
      <div class="add-tool-modal-header">
        <h3 :id="titleId" class="add-tool-modal-title">
          {{ t('commands.aiAddToolModalTitle') }}
        </h3>
        <IconButton
          icon="mdi:close"
          size="sm"
          variant="ghost"
          :label="t('common.cancel')"
          @click="close"
        />
      </div>

      <div class="add-tool-search">
        <FieldInput
          ref="searchInputRef"
          :model-value="searchQuery"
          :placeholder="t('commands.aiAddToolSearchPlaceholder')"
          :aria-label="t('commands.aiAddToolSearchPlaceholder')"
          autofocus
          @update:model-value="searchQuery = $event"
          @keydown.down.prevent="focusFirstTool"
        />
      </div>

      <div class="add-tool-content">
        <div
          v-for="group in filteredGroups"
          :key="group.id"
          class="add-tool-group"
        >
          <template v-if="group.items.length">
            <div class="add-tool-group-header">
              <AppIcon
                v-if="group.icon"
                :icon="group.icon"
                size="sm"
                class="add-tool-group-icon"
                aria-hidden="true"
              />
              <span class="add-tool-group-title">{{ group.label }}</span>
            </div>

            <div class="add-tool-group-items" role="list">
              <button
                v-for="item in group.items"
                :key="refKey(item.ref)"
                type="button"
                role="listitem"
                :data-tool="refKey(item.ref)"
                class="add-tool-row"
                :class="{
                  'is-clickable': !isSelected(item.ref),
                  'is-added': isSelected(item.ref),
                }"
                :disabled="isSelected(item.ref)"
                @pointerdown="preventMouseFocus"
                @keydown="handleToolKeydown($event)"
                @click="handleAdd(item)"
              >
                <span class="add-tool-row-label">{{ item.label }}</span>
                <div class="add-tool-row-meta">
                  <Badge :tone="isRiskyTool(item.risk) ? 'warning' : 'muted'">
                    {{ t(TOOL_RISK_LABEL_KEYS[item.risk]) }}
                  </Badge>
                  <Badge v-if="isSelected(item.ref)" tone="muted">
                    {{ t('commands.aiToolAlreadyAdded') }}
                  </Badge>
                </div>
              </button>
            </div>
          </template>

          <div
            v-else-if="!searchQuery && group.emptyMessage"
            class="add-tool-group-empty-block"
          >
            <div class="add-tool-group-header">
              <AppIcon
                v-if="group.icon"
                :icon="group.icon"
                size="sm"
                class="add-tool-group-icon"
                aria-hidden="true"
              />
              <span class="add-tool-group-title">{{ group.label }}</span>
            </div>
            <p class="add-tool-group-empty">{{ group.emptyMessage }}</p>
          </div>
        </div>

        <p v-if="totalMatchingItems === 0" class="add-tool-empty">
          {{ t('commands.aiAddToolEmpty') }}
        </p>
      </div>
    </div>
  </BaseDialog>
</template>

<script setup lang="ts">
import { computed, nextTick, ref, useId, watch } from 'vue'

import { useI18n } from '../../composables/use-i18n'
import { isRiskyTool } from '../../lib/chat-tools/tool-catalog'
import { TOOL_RISK_LABEL_KEYS } from '../../lib/chat-tools/tool-catalog-entries'
import { preventMouseFocus } from '../../lib/ui/focus'
import AppIcon from '../common/AppIcon.vue'
import Badge from '../common/Badge.vue'
import BaseDialog from '../common/BaseDialog.vue'
import FieldInput from '../common/FieldInput.vue'
import IconButton from '../common/IconButton.vue'
import type { ToolRef, ToolRisk } from '@tyco/shared'

export interface ToolCandidate {
  ref: ToolRef
  label: string
  risk: ToolRisk
}

export interface ToolCandidateGroup {
  id: string
  label: string
  icon: string
  emptyMessage?: string
  items: ToolCandidate[]
}

const props = defineProps<{
  open: boolean
  candidateGroups: ToolCandidateGroup[]
  isSelected: (ref: ToolRef) => boolean
}>()

const emit = defineEmits<{ close: []; add: [ref: ToolRef] }>()

const { t } = useI18n()
const titleId = useId()
const searchQuery = ref('')
const searchInputRef = ref<InstanceType<typeof FieldInput> | null>(null)

watch(
  () => props.open,
  async (isOpen) => {
    if (isOpen) {
      searchQuery.value = ''
      await nextTick()
      await nextTick()
      searchInputRef.value?.focus()
    }
  }
)

const refKey = (ref: ToolRef) =>
  [ref.sourceKind, ref.sourceId, ref.toolName ?? ''].join(':')

const filteredGroups = computed(() => {
  const query = searchQuery.value.trim().toLowerCase()
  if (!query) return props.candidateGroups

  return props.candidateGroups.map((group) => ({
    ...group,
    items: group.items.filter((item) =>
      item.label.toLowerCase().includes(query)
    ),
  }))
})

const totalMatchingItems = computed(() =>
  filteredGroups.value.reduce((acc, group) => acc + group.items.length, 0)
)

function focusFirstTool() {
  const root = searchInputRef.value?.$el
  const container =
    root instanceof Element ? root.closest('.add-tool-modal') : null
  const firstButton = container?.querySelector('.add-tool-row:not(:disabled)')
  if (firstButton instanceof HTMLElement) {
    firstButton.focus()
  }
}

function handleToolKeydown(event: KeyboardEvent) {
  const container = (event.currentTarget as HTMLElement | null)?.closest(
    '.add-tool-content'
  )
  const buttons = Array.from(
    container?.querySelectorAll<HTMLButtonElement>(
      '.add-tool-row:not(:disabled)'
    ) ?? []
  )
  if (buttons.length === 0) return

  const currentIndex = buttons.indexOf(event.currentTarget as HTMLButtonElement)
  if (currentIndex < 0) return

  let nextIndex: number
  if (event.key === 'ArrowDown') {
    nextIndex = (currentIndex + 1) % buttons.length
  } else if (event.key === 'ArrowUp') {
    if (currentIndex === 0) {
      event.preventDefault()
      searchInputRef.value?.focus()
      return
    }
    nextIndex = (currentIndex - 1 + buttons.length) % buttons.length
  } else if (event.key === 'Home') {
    nextIndex = 0
  } else if (event.key === 'End') {
    nextIndex = buttons.length - 1
  } else {
    return
  }

  event.preventDefault()
  buttons[nextIndex]?.focus()
}

function handleAdd(item: ToolCandidate) {
  if (props.isSelected(item.ref)) return
  emit('add', item.ref)
}

function close() {
  emit('close')
}
</script>

<style scoped>
.add-tool-dialog {
  width: min(100% - 2 * var(--space-lg), 36rem);
  overflow: hidden;
}

.add-tool-modal {
  display: flex;
  flex-direction: column;
  gap: var(--space-md);
}

.add-tool-modal-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-sm);
  flex-shrink: 0;
}

.add-tool-modal-title {
  margin: 0;
  color: var(--color-base-content);
  font-size: var(--text-title);
  font-weight: 600;
  line-height: var(--leading-tight);
}

.add-tool-search {
  display: flex;
  flex-direction: column;
  flex-shrink: 0;
}

.add-tool-content {
  display: flex;
  flex-direction: column;
  gap: var(--space-md);
  max-height: min(18rem, calc(100dvh - 14rem));
  overflow-y: auto;
  overscroll-behavior: contain;
  padding-right: var(--space-2xs);
}

.add-tool-group {
  display: flex;
  flex-direction: column;
  gap: var(--space-xs);
}

.add-tool-group-header {
  display: flex;
  align-items: center;
  gap: var(--space-xs);
  padding: var(--space-xs) var(--space-2xs) 0;
}

.add-tool-group-icon {
  flex-shrink: 0;
  color: var(--color-secondary);
}

.add-tool-group-title {
  font-size: var(--text-caption);
  font-weight: 600;
  color: var(--app-text-muted);
  text-transform: uppercase;
  letter-spacing: 0.04em;
}

.add-tool-group-items {
  display: flex;
  flex-direction: column;
  gap: var(--space-2xs);
}

.add-tool-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-sm);
  min-height: 2.25rem;
  padding: var(--space-xs) var(--space-sm);
  border-radius: var(--radius-md);
  border: 1px solid var(--app-border-subtle);
  background-color: var(--app-surface-raised);
  transition:
    background-color var(--transition-fast),
    border-color var(--transition-fast);
}

.add-tool-row.is-clickable {
  cursor: pointer;
}

.add-tool-row.is-clickable:hover {
  background-color: var(--app-hover);
  border-color: var(--app-border);
}

.add-tool-row.is-clickable:focus-visible {
  outline: 2px solid var(--color-primary);
  outline-offset: -2px;
}

.add-tool-row.is-added {
  opacity: 0.6;
  cursor: default;
}

.add-tool-row-label {
  flex: 1 1 auto;
  min-width: 0;
  font-size: var(--text-body);
  color: var(--color-base-content);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.add-tool-row-meta {
  display: flex;
  align-items: center;
  gap: var(--space-xs);
  flex-shrink: 0;
}

.add-tool-group-empty-block {
  display: flex;
  flex-direction: column;
  gap: var(--space-3xs);
}

.add-tool-group-empty,
.add-tool-empty {
  margin: var(--space-xs) var(--space-2xs) 0;
  font-size: var(--text-caption);
  color: var(--app-text-muted);
}
</style>
