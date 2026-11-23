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
          :model-value="searchQuery"
          :placeholder="t('commands.aiAddToolSearchPlaceholder')"
          :aria-label="t('commands.aiAddToolSearchPlaceholder')"
          @update:model-value="searchQuery = $event"
        />
      </div>

      <div class="add-tool-content" role="list">
        <template v-for="group in filteredGroups" :key="group.id">
          <div
            v-if="group.items.length || (!searchQuery && group.emptyMessage)"
            class="add-tool-group"
          >
            <h4 class="add-tool-group-title">{{ group.label }}</h4>
            <div v-if="group.items.length" class="add-tool-group-items">
              <button
                v-for="item in group.items"
                :key="refKey(item.ref)"
                type="button"
                class="add-tool-item"
                :class="{ 'add-tool-item--added': isSelected(item.ref) }"
                :disabled="isSelected(item.ref)"
                @click="handleAdd(item)"
              >
                <div class="add-tool-item-main">
                  <AppIcon
                    :icon="toolIcon(item.ref)"
                    size="md"
                    class="add-tool-item-icon"
                    aria-hidden="true"
                  />
                  <span class="add-tool-item-name">{{ item.label }}</span>
                </div>
                <div class="add-tool-item-badges">
                  <Badge v-if="isRiskyTool(item.risk)" tone="warning">
                    {{ t(TOOL_RISK_LABEL_KEYS[item.risk]) }}
                  </Badge>
                  <Badge v-if="isSelected(item.ref)" tone="muted">
                    {{ t('commands.aiToolAlreadyAdded') }}
                  </Badge>
                  <AppIcon
                    v-else
                    icon="mdi:plus"
                    size="sm"
                    class="add-tool-item-add-icon"
                    aria-hidden="true"
                  />
                </div>
              </button>
            </div>
            <p v-else class="add-tool-group-empty">
              {{ group.emptyMessage }}
            </p>
          </div>
        </template>
        <p v-if="totalMatchingItems === 0" class="add-tool-empty">
          {{ t('commands.aiAddToolEmpty') }}
        </p>
      </div>
    </div>
  </BaseDialog>
</template>

<script setup lang="ts">
import { computed, ref, useId, watch } from 'vue'

import { useI18n } from '../../composables/use-i18n'
import { isRiskyTool } from '../../lib/chat-tools/tool-catalog'
import { TOOL_RISK_LABEL_KEYS } from '../../lib/chat-tools/tool-catalog-entries'
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

watch(
  () => props.open,
  (isOpen) => {
    if (isOpen) {
      searchQuery.value = ''
    }
  }
)

const refKey = (ref: ToolRef) =>
  [ref.sourceKind, ref.sourceId, ref.toolName ?? ''].join(':')

function toolIcon(ref: ToolRef): string {
  if (ref.sourceKind === 'core' && ref.sourceId === 'web') return 'mdi:web'
  if (ref.sourceKind === 'commands') return 'mdi:lightning-bolt-outline'
  if (ref.sourceKind === 'plugin') return 'mdi:puzzle-outline'
  return 'mdi:wrench-outline'
}

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
  width: min(100% - 2 * var(--space-lg), 32rem);
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
}

.add-tool-content {
  display: flex;
  flex-direction: column;
  gap: var(--space-md);
  max-height: 22rem;
  overflow-y: auto;
  overscroll-behavior: contain;
  padding-right: var(--space-2xs);
}

.add-tool-group {
  display: flex;
  flex-direction: column;
  gap: var(--space-xs);
}

.add-tool-group-title {
  margin: 0;
  font-size: var(--text-caption);
  font-weight: 600;
  color: var(--app-text-muted);
}

.add-tool-group-items {
  display: flex;
  flex-direction: column;
  gap: var(--space-xs);
}

.add-tool-item {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-sm);
  padding: var(--space-sm) var(--space-md);
  border: 1px solid var(--app-border-subtle);
  border-radius: var(--radius-md);
  background-color: var(--app-surface-raised);
  text-align: start;
  color: inherit;
  cursor: pointer;
  transition:
    background-color var(--transition-fast),
    border-color var(--transition-fast);
}

.add-tool-item:hover:not(:disabled) {
  background-color: var(--app-hover);
  border-color: var(--app-border);
}

.add-tool-item--added {
  opacity: 0.6;
  cursor: not-allowed;
}

.add-tool-item-main {
  display: flex;
  align-items: center;
  gap: var(--space-sm);
  min-width: 0;
}

.add-tool-item-icon {
  flex-shrink: 0;
  color: var(--color-primary);
}

.add-tool-item-name {
  font-size: var(--text-body);
  font-weight: 500;
  color: var(--color-base-content);
}

.add-tool-item-badges {
  display: flex;
  align-items: center;
  gap: var(--space-xs);
  flex-shrink: 0;
}

.add-tool-item-add-icon {
  color: var(--app-text-muted);
}

.add-tool-group-empty,
.add-tool-empty {
  margin: var(--space-xs) 0;
  font-size: var(--text-caption);
  color: var(--app-text-muted);
}
</style>
