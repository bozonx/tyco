<template>
  <div class="shortcuts-list">
    <div>
      <div class="flex flex-row gap-2">
        <span v-if="props.spaceKey" class="flex flex-row gap-1"
          ><KeyButton>Space</KeyButton>
          <Button
            :disabled="props.spaceKey.disabled"
            sm
            neutral
            @click="props.spaceKey.action(props.text || '')"
            >{{ getActionLabel(props.spaceKey) }}</Button
          >
        </span>
        <span v-if="props.toEditorVisible" class="flex flex-row gap-2">
          <KeyButton>Tab</KeyButton>
          <Button sm neutral @click="routeParamsStore.toEditor(props.text)">{{
            t('shortcuts.insertIntoEditor')
          }}</Button>
        </span>
      </div>

      <div class="flex flex-row gap-4 mt-2">
        <div class="flex flex-col gap-1">
          <div
            v-for="item in col1"
            :key="item.labelKey || item.name || item.key"
          >
            <span class="flex flex-row gap-1">
              <KeyButton>{{ item.key }}</KeyButton>
              <Button
                v-if="getActionLabel(item)"
                :disabled="item.disabled"
                sm
                neutral
                :icon="item.icon"
                @click="item.action(props.text || '')"
                >{{ getActionLabel(item) }}</Button
              >
            </span>
          </div>
        </div>
        <div class="flex flex-col gap-1">
          <div
            v-for="item in col2"
            :key="item.labelKey || item.name || item.key"
          >
            <span class="flex flex-row gap-1"
              ><KeyButton>{{ item.key }}</KeyButton>
              <Button
                v-if="getActionLabel(item)"
                :disabled="item.disabled"
                sm
                neutral
                :icon="item.icon"
                @click="item.action(props.text || '')"
                >{{ getActionLabel(item) }}</Button
              ></span
            >
          </div>
        </div>
        <div class="flex flex-col gap-1">
          <div
            v-for="item in col3"
            :key="item.labelKey || item.name || item.key"
          >
            <span class="flex flex-row gap-1"
              ><KeyButton>{{ item.key }}</KeyButton>
              <Button
                v-if="getActionLabel(item)"
                :disabled="item.disabled"
                sm
                neutral
                :icon="item.icon"
                @click="item.action(props.text || '')"
                >{{ getActionLabel(item) }}</Button
              ></span
            >
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, onUnmounted } from 'vue'

import { GlobalEvents, useGlobalEvents } from '../composables/useGlobalEvents'
import { useI18n } from '../composables/useI18n'
import { ActionItem } from '../stores/actionMenu'
import { useRouteParams } from '../stores/routeParams'
import { PRESETS_KEYS } from '../types'

const props = withDefaults(
  defineProps<{
    text?: string
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

const col1 = computed(() =>
  PRESETS_KEYS.slice(0, 5).map((key, index) => ({
    key,
    ...props.leftLetterKeys[index],
  }))
)
const col2 = computed(() =>
  PRESETS_KEYS.slice(5, 10).map((key, index) => ({
    key,
    ...props.leftLetterKeys[index + 5],
  }))
)
const col3 = computed(() =>
  PRESETS_KEYS.slice(10, 15).map((key, index) => ({
    key,
    ...props.leftLetterKeys[index + 10],
  }))
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
    routeParamsStore.toEditor(props.text)
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
  text-align: left;
  font-family: var(--font-mono);
  font-size: 0.875rem;
  line-height: 1.5;
  white-space: pre-wrap;
  display: flex;
  justify-content: center;
}
</style>
