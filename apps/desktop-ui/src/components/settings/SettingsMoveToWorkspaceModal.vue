<template>
  <BaseDialog
    class="move-dialog"
    :open="entity !== null"
    :labelledby="titleId"
    @close="close"
  >
    <form class="move-modal" @submit.prevent="submit">
      <h3 :id="titleId" class="move-modal-title">
        {{ t('settings.moveToWorkspace.title', { name: entity?.name ?? '' }) }}
      </h3>

      <FieldRow
        vertical
        :separator="false"
        :label="t('settings.moveToWorkspace.target')"
      >
        <FieldSelect
          v-model="targetId"
          :options="targetOptions"
          :disabled="isSubmitting"
          data-testid="move-target"
        />
      </FieldRow>

      <ul class="move-modal-notes">
        <li>{{ movesText }}</li>
        <li v-if="lostNames.length > 0">{{ losesText }}</li>
        <li v-if="kind === 'project' && isExternal">
          {{ t('settings.moveToWorkspace.externalFolder') }}
        </li>
        <li>{{ t('settings.moveToWorkspace.otherDevices') }}</li>
      </ul>

      <div class="move-modal-actions">
        <Button
          size="sm"
          variant="ghost"
          type="button"
          :disabled="isSubmitting"
          @click="close"
        >
          {{ t('common.cancel') }}
        </Button>
        <Button
          size="sm"
          variant="primary"
          type="submit"
          :loading="isSubmitting"
          :disabled="targetOptions.length === 0"
        >
          {{ t('settings.moveToWorkspace.confirm') }}
        </Button>
      </div>
    </form>
  </BaseDialog>
</template>

<script setup lang="ts">
import { computed, ref, useId, watch } from 'vue'

import { useI18n } from '../../composables/use-i18n'
import {
  moveTargets,
  profilesLosingProject,
  projectsLostByProfile,
} from '../../lib/ai-profiles/entity-move'
import { vaultLabel } from '../../lib/ai-profiles/vault-groups'
import { useAiProfilesStore } from '../../stores/ai-profiles'
import BaseDialog from '../common/BaseDialog.vue'
import Button from '../common/Button.vue'
import FieldRow from '../common/FieldRow.vue'
import FieldSelect from '../common/FieldSelect.vue'

/** Moves a profile or a project to another workspace */
const props = defineProps<{
  kind: 'profile' | 'project'
  /** The entity to move; the dialog is open while it is set */
  entity: { id: string; name: string } | null
  isSubmitting?: boolean
}>()

const emit = defineEmits<{ close: []; confirm: [vaultId: string] }>()

const { t } = useI18n()
const titleId = useId()
const store = useAiProfilesStore()

const targets = computed(() =>
  props.entity ? moveTargets(props.entity.id, store.vaults) : []
)
const targetOptions = computed(() =>
  targets.value.map((vault) => ({
    id: vault.vaultId,
    name: vaultLabel(vault, t('settings.aiVaults.main')),
  }))
)
const targetId = ref('')
watch(
  () => props.entity?.id,
  () => {
    targetId.value = targets.value[0]?.vaultId ?? ''
  },
  { immediate: true }
)

const lostNames = computed(() => {
  const entity = props.entity
  if (!entity) return []
  if (props.kind === 'project')
    return profilesLosingProject(entity.id, store.profiles)
  const profile = store.profiles.find((item) => item.id === entity.id)
  return profile ? projectsLostByProfile(profile, store.projects) : []
})

const movesText = computed(() =>
  props.kind === 'profile'
    ? t('settings.moveToWorkspace.profileMoves')
    : t('settings.moveToWorkspace.projectMoves')
)
const losesText = computed(() => {
  const names = lostNames.value.join(', ')
  return props.kind === 'profile'
    ? t('settings.moveToWorkspace.profileLoses', { names })
    : t('settings.moveToWorkspace.projectLoses', { names })
})

const isExternal = computed(
  () =>
    store.projects.find((project) => project.id === props.entity?.id)
      ?.isExternal === true
)

function submit() {
  if (props.isSubmitting || !targets.value.length) return
  emit('confirm', targetId.value)
}

function close() {
  if (!props.isSubmitting) emit('close')
}
</script>

<style scoped>
.move-dialog {
  width: min(100% - 2 * var(--space-lg), 30rem);
}

.move-modal {
  display: flex;
  flex-direction: column;
  gap: var(--space-lg);
}

.move-modal-title {
  margin: 0;
  color: var(--color-base-content);
  font-size: var(--text-title);
  font-weight: 600;
  line-height: var(--leading-tight);
}

.move-modal-notes {
  display: flex;
  flex-direction: column;
  gap: var(--space-xs);
  margin: 0;
  padding-left: var(--space-lg);
  color: var(--app-text-muted);
  font-size: var(--text-caption);
  list-style: disc;
}

.move-modal-actions {
  display: flex;
  justify-content: flex-end;
  gap: var(--space-sm);
}
</style>
