<template>
  <div class="shortcuts-list">
    <div
      v-if="props.spaceKey || props.toEditorVisible"
      class="shortcuts-primary"
    >
      <ShortcutButton
        v-if="props.spaceKey"
        :keys="['Space']"
        :icon="props.spaceKey.icon"
        :disabled="props.spaceKey.disabled"
        primary
        @click="props.spaceKey.action(props.text || '')"
        >{{ getActionLabel(props.spaceKey) }}</ShortcutButton
      >
      <ShortcutButton
        v-if="props.toEditorVisible"
        :keys="['Tab']"
        icon="mdi:pencil-outline"
        @click="routeParamsStore.toEditor(props.text, props.sourceText)"
        >{{ t('shortcuts.insertIntoEditor') }}</ShortcutButton
      >
    </div>

    <div v-if="columns.length > 0" class="shortcuts-grid">
      <div
        v-for="(column, index) in columns"
        :key="index"
        class="shortcuts-col"
      >
        <ShortcutButton
          v-for="item in column"
          :key="item.key"
          :keys="[item.key]"
          :icon="item.icon"
          :disabled="item.disabled"
          @click="item.action(props.text || '')"
          >{{ getActionLabel(item) }}</ShortcutButton
        >
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, onUnmounted } from 'vue'

import { GlobalEvents, useGlobalEvents } from '../composables/useGlobalEvents'
import { useI18n } from '../composables/useI18n'
import { type ActionItem } from '../stores/actionMenu'
import { useRouteParams } from '../stores/routeParams'
import { PRESETS_KEYS } from '../types'

const props = withDefaults(
  defineProps<{
    text?: string
    /** What `text` was transformed from, see `routeParams.toEditor`. */
    sourceText?: string
    spaceKey?: ActionItem
    toEditorVisible?: boolean
    leftLetterKeys?: ActionItem[]
    stopListening?: boolean
  }>(),
  {
    text: '',
    spaceKey: undefined,
    toEditorVisible: false,
    leftLetterKeys: () => [],
    stopListening: false,
  }
)

const routeParamsStore = useRouteParams()
const { globalEvents } = useGlobalEvents()
const { t } = useI18n()
let keyUpHanlderIndex: number

/**
 * One column per row of preset keys (q–t, a–g, z–b), so the layout mirrors the
 * keyboard. Keys without an action are left out, empty columns too
 */
const columns = computed(() =>
  [0, 5, 10]
    .map((offset) =>
      PRESETS_KEYS.slice(offset, offset + 5)
        .map((key, index) => ({ key, ...props.leftLetterKeys[index + offset] }))
        .filter((item) => getActionLabel(item as ActionItem))
    )
    .filter((column) => column.length > 0)
)

onMounted(() => {
  keyUpHanlderIndex = globalEvents.addListener(
    GlobalEvents.KEY_UP,
    handleShortCutKeyUp
  )
})

onUnmounted(() => {
  globalEvents.removeListener(keyUpHanlderIndex)
})

function handleShortCutKeyUp(event: KeyboardEvent) {
  if (props.stopListening) {
    return
  }

  if (event.code === 'Space' && !props.spaceKey?.disabled) {
    props.spaceKey?.action(props.text || '')
  } else if (event.code === 'Tab' && props.toEditorVisible) {
    routeParamsStore.toEditor(props.text, props.sourceText)
  }

  let codeLetter
  if (event.code.length === 4 && event.code.startsWith('Key')) {
    codeLetter = event.code.slice(3).toLowerCase()
  }

  if (codeLetter && PRESETS_KEYS.includes(codeLetter)) {
    props.leftLetterKeys[PRESETS_KEYS.indexOf(codeLetter)]?.action(
      props.text || ''
    )
  }
}

function getActionLabel(item?: ActionItem) {
  if (!item) {
    return ''
  }

  return item.labelKey ? t(item.labelKey) : item.name || ''
}
</script>

<style scoped>
.shortcuts-list {
  display: flex;
  flex-direction: column;
  gap: var(--space-md);
}

.shortcuts-primary {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
  gap: var(--space-sm);
}

.shortcuts-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
  gap: 2px var(--space-sm);
  padding-top: var(--space-md);
  border-top: 1px solid var(--app-border-subtle);
}

.shortcuts-col {
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-width: 0;
}
</style>
