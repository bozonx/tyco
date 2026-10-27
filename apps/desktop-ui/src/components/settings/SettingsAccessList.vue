<template>
  <div class="settings-entity-list">
    <slot name="leading" />
    <SettingsEntityItem
      v-for="entry in entries"
      :key="entry.id"
      :icon="entry.icon"
      icon-tone="secondary"
      :title="entry.title"
      :description="entry.description"
      :openable="openable"
      @open="emit('open', entry.id)"
    >
      <span
        v-if="entry.warning"
        class="settings-entity-meta access-warning"
        :title="entry.warning"
      >
        <AppIcon icon="mdi:alert-outline" size="sm" aria-hidden="true" />
        {{ entry.warning }}
      </span>
      <FieldSelect
        size="sm"
        :aria-label="`${entry.title}: ${t('settings.accessLevel')}`"
        :model-value="entry.level"
        :options="levelOptions"
        @update:model-value="
          emit('change', entry.id, $event as ProjectAccessLevel)
        "
      />
      <template #actions>
        <IconButton
          size="xs"
          icon="mdi:link-variant-off"
          :label="t('settings.accessRemove')"
          :title="t('settings.accessRemove')"
          @click="emit('change', entry.id, undefined)"
        />
      </template>
    </SettingsEntityItem>
    <StateMessage
      v-if="entries.length === 0"
      density="compact"
      :message="emptyMessage"
    />
    <div v-if="candidates.length > 0" class="access-add">
      <DropdownMenu
        size="sm"
        variant="neutral"
        icon="mdi:plus"
        :label="addLabel"
        :items="addItems"
      />
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'

import { useI18n } from '../../composables/use-i18n'
import {
  DEFAULT_PROJECT_ACCESS_LEVEL,
  PROJECT_ACCESS_LABEL_KEYS,
  PROJECT_ACCESS_LEVELS,
  type ProjectAccessLevel,
} from '../../lib/ai-profiles/project-access'
import AppIcon from '../common/AppIcon.vue'
import DropdownMenu, { type DropdownMenuItem } from '../common/DropdownMenu.vue'
import FieldSelect from '../common/FieldSelect.vue'
import IconButton from '../common/IconButton.vue'
import StateMessage from '../common/StateMessage.vue'
import SettingsEntityItem from './SettingsEntityItem.vue'

export interface AccessListEntry {
  id: string
  icon?: string
  title: string
  description?: string
  level: ProjectAccessLevel
  /** Why the access does nothing now */
  warning?: string
}

export interface AccessListCandidate {
  id: string
  icon?: string
  label: string
}

const props = defineProps<{
  entries: readonly AccessListEntry[]
  /** What can be connected yet */
  candidates: readonly AccessListCandidate[]
  addLabel: string
  emptyMessage: string
  openable?: boolean
}>()
const emit = defineEmits<{
  /** `undefined` disconnects */
  change: [id: string, level: ProjectAccessLevel | undefined]
  open: [id: string]
}>()
const { t } = useI18n()

const levelOptions = computed(() =>
  PROJECT_ACCESS_LEVELS.map((level) => ({
    id: level,
    name: t(PROJECT_ACCESS_LABEL_KEYS[level]),
  }))
)

const addItems = computed<DropdownMenuItem[]>(() =>
  props.candidates.map((candidate) => ({
    label: candidate.label,
    icon: candidate.icon,
    action: () => emit('change', candidate.id, DEFAULT_PROJECT_ACCESS_LEVEL),
  }))
)
</script>

<style scoped>
.access-warning {
  display: inline-flex;
  align-items: center;
  gap: var(--space-2xs);
  color: var(--color-warning);
}

.access-add {
  display: flex;
}
</style>
