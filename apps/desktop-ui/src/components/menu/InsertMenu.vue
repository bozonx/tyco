<template>
  <div class="insert-menu">
    <h1>{{ t('menu.insert') }}</h1>

    <div class="insert-preview">
      <DiffInput
        v-if="props.oldText"
        :oldText="props.oldText"
        :newText="props.text"
        @update:new-text="handleNewText"
      />
      <TextPreview v-else :text="props.text" />
    </div>

    <ShortcutList
      :text="props.text"
      :leftLetterKeys="leftLetterKeys"
      :spaceKey="spaceKey"
      :stopListening="props.stopListening"
      :toEditorVisible="
        props.toEditorVisible ?? !routeParamsStore.isEditorPage()
      "
    />
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'

import { useI18n } from '../../composables/useI18n'
import { type ActionItem, useActionMenuStore } from '../../stores/actionMenu'
import { useIpcStore } from '../../stores/ipc'
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

const emit = defineEmits<{ (e: 'update:text', value: string): void }>()

const ipcStore = useIpcStore()
const actionMenuStore = useActionMenuStore()
const actionsMenu = computed(
  () => props.actions || actionMenuStore.getShortcutActions()
)
const { t } = useI18n()

const leftLetterKeys = computed<(ActionItem | undefined)[]>(() =>
  actionsMenu.value.map((item: ActionItem | undefined, index: number) =>
    item ? { ...item, disabled: shouldDisablePrimaryAction(index) } : undefined
  )
)

const spaceKey = computed<ActionItem | undefined>(() => {
  const [firstItem] = actionsMenu.value

  if (!firstItem) {
    return undefined
  }

  return { ...firstItem, disabled: shouldDisablePrimaryAction(0) }
})

function handleNewText(newText: string) {
  emit('update:text', newText)
}

function needShowInsertButton() {
  return Boolean(
    ipcStore.params?.windowId && props.text && props.allowInsertButton
  )
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

<style scoped>
.insert-menu {
  display: flex;
  flex-direction: column;
  gap: var(--space-lg);
  width: 100%;
  height: 100%;
  min-height: 0;
  overflow-y: auto;
}

.insert-menu > :not(.insert-preview) {
  flex-shrink: 0;
}

.insert-preview {
  flex: 1 0 10rem;
  min-height: 10rem;
}
</style>
