<template>
  <div class="settings-entity-list">
    <SettingsEntityItem
      icon="mdi:folder-account-outline"
      icon-tone="secondary"
      :title="t('settings.profileWorkspace')"
      :description="t('settings.profileWorkspaceHint')"
    >
      <span class="settings-entity-meta">{{
        t('settings.profileWorkspaceAccess')
      }}</span>
    </SettingsEntityItem>
    <SettingsEntityItem
      v-for="project in projects"
      :key="project.id"
      :icon="
        project.isExternal
          ? 'mdi:folder-open-outline'
          : 'mdi:folder-table-outline'
      "
      icon-tone="secondary"
      :title="project.name"
      :description="project.description || undefined"
    >
      <span
        v-for="kind in PERMISSION_KINDS"
        :key="kind"
        class="project-permission"
      >
        <span class="settings-entity-meta">{{
          t(PERMISSION_LABEL_KEYS[kind])
        }}</span>
        <SegmentedControl
          size="sm"
          :label="`${project.name}: ${t(PERMISSION_LABEL_KEYS[kind])}`"
          :model-value="permissionOf(project.id)[kind]"
          :options="permissionOptions"
          @update:model-value="
            change(project.id, kind, $event as ProjectAccessMode)
          "
        />
      </span>
    </SettingsEntityItem>
    <StateMessage
      v-if="projects.length === 0"
      density="compact"
      :message="t('settings.noProjectsYet')"
    />
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'

import { useI18n } from '../../composables/use-i18n'
import SegmentedControl from '../common/SegmentedControl.vue'
import StateMessage from '../common/StateMessage.vue'
import SettingsEntityItem from './SettingsEntityItem.vue'
import {
  type AiProject,
  DEFAULT_PROJECT_PERMISSION,
  type ProjectAccessMode,
  type ProjectPermission,
} from '@tyco/shared'

const props = defineProps<{
  projects: readonly AiProject[]
  permissions: Record<string, ProjectPermission>
}>()
const emit = defineEmits<{
  change: [projectId: string, permission: ProjectPermission]
}>()
const { t } = useI18n()

const PERMISSION_KINDS = [
  'read',
  'write',
] as const satisfies readonly (keyof ProjectPermission)[]
const PERMISSION_LABEL_KEYS = {
  read: 'settings.accessRead',
  write: 'settings.accessWrite',
} as const

const permissionOptions = computed(() => [
  { id: 'deny', name: t('settings.accessDeny') },
  { id: 'ask', name: t('settings.accessAsk') },
  { id: 'allow', name: t('settings.accessAllow') },
])

function permissionOf(projectId: string): ProjectPermission {
  return props.permissions[projectId] ?? DEFAULT_PROJECT_PERMISSION
}

function change(
  projectId: string,
  kind: keyof ProjectPermission,
  mode: ProjectAccessMode
) {
  emit('change', projectId, { ...permissionOf(projectId), [kind]: mode })
}
</script>

<style scoped>
.project-permission {
  display: flex;
  align-items: center;
  gap: var(--space-sm);
}
</style>
