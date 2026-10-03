<template>
  <ActionOverlayLayout :title="t('settings.selectAction')" escMode="back">
    <template #preview>
      <div class="flex flex-col gap-2 p-3 overflow-y-auto h-full">
        <Button
          v-for="action in actions"
          :key="action.id"
          neutral
          class="justify-start text-left w-full"
          @click="selectAction(action.id)"
        >
          {{ action.name }}
        </Button>
      </div>
    </template>
  </ActionOverlayLayout>
</template>

<script setup lang="ts">
import { computed } from 'vue'

import { useI18n } from '../../composables/useI18n'
import { useActionMenuStore } from '../../stores/actionMenu'
import { useMenuModalsStore } from '../../stores/menuModals'
import ActionOverlayLayout from '../common/ActionOverlayLayout.vue'
import Button from '../common/Button.vue'

const { t } = useI18n()
const menuModalsStore = useMenuModalsStore()
const actionMenuStore = useActionMenuStore()

const props = defineProps<{ onSelect: (actionId: string) => void }>()

const actions = computed(() => {
  return actionMenuStore
    .getDefaultActions()
    .map((action: any) => ({
      id: action.labelKey?.replace('action.', '') || action.name || '',
      name: action.labelKey ? t(action.labelKey) : action.name || '',
    }))
    .filter((a: any) => a.id)
})

function selectAction(id: string) {
  props.onSelect(id)
  menuModalsStore.back()
}
</script>
