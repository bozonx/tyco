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

      <div class="add-tool-content">
        <template v-for="group in filteredGroups" :key="group.id">
          <SettingsToolSource
            v-if="group.items.length"
            :icon="group.icon"
            :title="group.label"
          >
            <SettingsToolRow
              v-for="item in group.items"
              :key="refKey(item.ref)"
              :name="refKey(item.ref)"
              :label="item.label"
              :risk="item.risk"
            >
              <Badge v-if="isSelected(item.ref)" tone="muted">
                {{ t('commands.aiToolAlreadyAdded') }}
              </Badge>
              <IconButton
                v-else
                icon="mdi:plus"
                size="sm"
                variant="ghost"
                :label="`${t('commands.aiAddTool')}: ${item.label}`"
                @click="handleAdd(item)"
              />
            </SettingsToolRow>
          </SettingsToolSource>
          <div v-else-if="!searchQuery && group.emptyMessage">
            <SettingsToolSource :icon="group.icon" :title="group.label" />
            <p class="add-tool-group-empty">{{ group.emptyMessage }}</p>
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
import Badge from '../common/Badge.vue'
import BaseDialog from '../common/BaseDialog.vue'
import FieldInput from '../common/FieldInput.vue'
import IconButton from '../common/IconButton.vue'
import SettingsToolRow from './SettingsToolRow.vue'
import SettingsToolSource from './SettingsToolSource.vue'
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

.add-tool-group-empty,
.add-tool-empty {
  margin: var(--space-xs) var(--space-xs) 0;
  font-size: var(--text-caption);
  color: var(--app-text-muted);
}
</style>
