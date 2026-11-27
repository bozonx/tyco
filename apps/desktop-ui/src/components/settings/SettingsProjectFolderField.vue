<template>
  <FieldRow
    class="project-folder-field"
    vertical
    :separator="false"
    :label="t('settings.projectFolder')"
  >
    <PathDisplay
      :path="path"
      :placeholder="t('settings.projectFolderNotSelected')"
    >
      <template #actions>
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
      </template>
    </PathDisplay>
  </FieldRow>
</template>

<script setup lang="ts">
import { useI18n } from '../../composables/use-i18n'
import Button from '../common/Button.vue'
import FieldRow from '../common/FieldRow.vue'
import PathDisplay from '../common/PathDisplay.vue'

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
</style>
