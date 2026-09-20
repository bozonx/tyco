<template>
  <div class="flex flex-col gap-4 w-full h-full">
    <h1>{{ t('settings.selectAction') }}</h1>

    <div class="flex-1 overflow-y-auto">
      <div class="flex flex-col gap-2">
        <Button
          v-for="action in actions"
          :key="action.id"
          neutral
          class="justify-start text-left"
          @click="selectAction(action.id)"
        >
          {{ action.name }}
        </Button>
      </div>
    </div>

    <div class="flex flex-row justify-end gap-2">
      <Button neutral @click="menuModalsStore.back()">{{
        t('common.back')
      }}</Button>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'

import { useI18n } from '../../composables/useI18n'
import { useActionMenuStore } from '../../stores/actionMenu'
import { useMenuModalsStore } from '../../stores/menuModals'

const { t } = useI18n()
const menuModalsStore = useMenuModalsStore()
const actionMenuStore = useActionMenuStore()

const props = defineProps<{
  onSelect: (actionId: string) => void
}>()

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
