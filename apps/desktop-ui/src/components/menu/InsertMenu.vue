<template>
<div class="flex flex-col gap-4 w-full h-full"> 
  <h1>{{ t('menu.insert') }}</h1>

  <div class="flex-1">
    <DiffInput
      v-if="props.oldText"
      :oldText="props.oldText"
      :newText="props.text"
      @update:newText="handleNewText" />
    <TextPreview v-else :text="props.text" />
  </div>

  <ShortcutList
    :text="props.text"
    :leftLetterKeys="leftLetterKeys"
    :spaceKey="spaceKey"
    :stopListening="props.stopListening"
    :toEditorVisible="props.toEditorVisible ?? !routeParamsStore.isEditorPage()" />
</div>
</template>

<script setup lang="ts">
import { computed } from 'vue'

import { useI18n } from '../../composables/useI18n'
import { useIpcStore } from '../../stores/ipc'
import { type ActionItem, useActionMenuStore } from '../../stores/actionMenu'
import { useRouteParams } from '../../stores/routeParams'

const routeParamsStore = useRouteParams()

const props = withDefaults(
  defineProps<{
    text?: string
    oldText?: string
    actions?: ActionItem[]
    allowInsertButton?: boolean
    stopListening?: boolean
    toEditorVisible?: boolean
  }>(),
  {
    text: '',
    oldText: '',
    actions: undefined,
    allowInsertButton: true,
    stopListening: false,
    toEditorVisible: undefined,
  }
)

const emit = defineEmits<{
  (e: 'update:text', value: string): void
}>()

const ipcStore = useIpcStore()
const actionMenuStore = useActionMenuStore()
const actionsMenu = computed(() => props.actions || actionMenuStore.getActionsMenu())
const { t } = useI18n()

const leftLetterKeys = computed<ActionItem[]>(() =>
  actionsMenu.value.map((item: ActionItem, index: number) => ({
    ...item,
    disabled: shouldDisablePrimaryAction(index),
  }))
)

const spaceKey = computed<ActionItem | undefined>(() => {
  const [firstItem] = actionsMenu.value

  if (!firstItem) {
    return undefined
  }

  return {
    ...firstItem,
    disabled: shouldDisablePrimaryAction(0),
  }
})

function handleNewText(newText: string) {
  emit('update:text', newText)
}

function needShowInsertButton() {
  return Boolean(ipcStore.params?.windowId && props.text && props.allowInsertButton)
}

function shouldDisablePrimaryAction(index: number) {
  if (index !== 0) {
    return false
  }

  if (props.actions) {
    return false
  }

  return !needShowInsertButton()
}
</script>
