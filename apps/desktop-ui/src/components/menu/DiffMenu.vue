<template>
  <div class="flex flex-col gap-4 w-full h-full">
    <h1 class="menu-title">{{ t('menu.compareResult') }}</h1>
    <div class="flex-1 min-h-0 relative">
      <DiffInput
        :oldText="props.oldText"
        :newText="props.newText"
        @update:new-text="updateNewText"
      />
    </div>

    <ShortcutList
      :leftLetterKeys="leftLetterKeys"
      :spaceKey="spaceKey"
      :toEditorVisible="true"
    />
  </div>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue'

import { useI18n } from '../../composables/useI18n'
import { appNavigation } from '../../lib/navigation/navigation'
import { type ActionItem, useActionMenuStore } from '../../stores/actionMenu'
import { useEditorInputStore } from '../../stores/editorInput'
import { useIpcStore } from '../../stores/ipc'
import { useMenuModalsStore } from '../../stores/menuModals'
import { useRouteParams } from '../../stores/routeParams'

const props = defineProps<{ oldText: string; newText: string }>()

const ipcStore = useIpcStore()
const editorInputStore = useEditorInputStore()
const menuModalsStore = useMenuModalsStore()
const editedNewText = ref(props.newText)
const actionMenuStore = useActionMenuStore()
const routeParams = useRouteParams()
const { t } = useI18n()
const defaultActions = computed(() => actionMenuStore.getDefaultActions())

const leftLetterKeys = computed(
  () =>
    [
      ipcStore.params?.windowId ? defaultActions.value[0] : undefined,
      defaultActions.value[1],
      {
        labelKey: 'action.insertIntoEditor',
        action: async () => {
          editorInputStore.setValue(editedNewText.value, 'ai')
          routeParams.setParams({ text: editedNewText.value })
          editorInputStore.focus()
          menuModalsStore.closeAll()
          await appNavigation.goToEditor()
        },
      },
    ].filter(Boolean) as ActionItem[]
)

const spaceKey = computed(() =>
  ipcStore.params?.windowId ? defaultActions.value[0] : undefined
)

function updateNewText(text: string) {
  editedNewText.value = text
}
</script>
