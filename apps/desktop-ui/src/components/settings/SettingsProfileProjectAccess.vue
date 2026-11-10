<template>
  <SettingsAccessList
    :entries="entries"
    :candidates="candidates"
    :add-label="t('settings.connectProject')"
    :empty-message="
      projects.length === 0
        ? t('settings.noProjectsYet')
        : t('settings.noConnectedProjects')
    "
    openable
    @change="(projectId, level) => emit('change', projectId, level)"
    @open="(projectId) => emit('open', projectId)"
  />
</template>

<script setup lang="ts">
import { computed } from 'vue'

import { useI18n } from '../../composables/use-i18n'
import { projectIcon } from '../../lib/ai-profiles/profile-icons'
import {
  type ProjectAccessLevel,
  projectAccessLevelOf,
} from '../../lib/ai-profiles/project-access'
import SettingsAccessList, {
  type AccessListCandidate,
  type AccessListEntry,
} from './SettingsAccessList.vue'
import type { AiProject, ProjectPermission } from '@tyco/shared'

const props = defineProps<{
  projects: readonly AiProject[]
  permissions: Readonly<Record<string, ProjectPermission>>
}>()
const emit = defineEmits<{
  change: [projectId: string, level: ProjectAccessLevel | undefined]
  open: [projectId: string]
}>()
const { t } = useI18n()

const entries = computed<AccessListEntry[]>(() =>
  props.projects.flatMap((project) => {
    const level = projectAccessLevelOf(props.permissions[project.id])
    if (!level) return []
    return [
      {
        id: project.id,
        icon: projectIcon(project),
        title: project.name,
        description: project.description || undefined,
        level,
        // the profile keeps its access; the folder is set on each device
        warning:
          project.isExternal && !project.targetPath?.trim()
            ? t('settings.projectFolderNotSetOnDevice')
            : undefined,
      },
    ]
  })
)

const candidates = computed<AccessListCandidate[]>(() =>
  props.projects
    .filter((project) => !projectAccessLevelOf(props.permissions[project.id]))
    .map((project) => ({
      id: project.id,
      icon: projectIcon(project),
      label: project.name,
    }))
)
</script>
