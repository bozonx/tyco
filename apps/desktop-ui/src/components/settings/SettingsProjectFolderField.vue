<template>
  <FieldRow
    class="project-folder-field"
    vertical
    :separator="false"
    :label="t('settings.projectTargetPath')"
  >
    <div class="project-folder-control">
      <code v-if="path" class="project-folder-path">{{ path }}</code>
      <span v-else class="project-folder-empty">
        {{ t('settings.projectFolderNotSelected') }}
      </span>
      <Button
        size="sm"
        variant="neutral"
        icon="mdi:folder-open-outline"
        data-testid="project-folder-pick"
        :disabled="disabled"
        @click="emit('pick')"
      >
        {{ t('settings.selectFolder') }}
      </Button>
    </div>
  </FieldRow>
</template>

<script setup lang="ts">
import { useI18n } from '../../composables/use-i18n'
import Button from '../common/Button.vue'
import FieldRow from '../common/FieldRow.vue'

defineProps<{ path: string; disabled?: boolean }>()
const emit = defineEmits<{ pick: [] }>()

const { t } = useI18n()
</script>

<style scoped>
.project-folder-field {
  padding: 0;
}

.project-folder-field :deep(.field-row-control) {
  width: 100%;
}

.project-folder-control {
  display: flex;
  align-items: center;
  gap: var(--space-sm);
  min-width: 0;
}

.project-folder-path,
.project-folder-empty {
  flex: 1;
  min-width: 0;
  overflow-wrap: anywhere;
  font-size: var(--text-control);
}

.project-folder-empty {
  color: var(--app-text-muted);
}

.project-folder-control > :last-child {
  flex-shrink: 0;
}
</style>
