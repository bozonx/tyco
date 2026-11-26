<template>
  <Teleport to="body">
    <MenuSurface
      ref="menuSurfaceRef"
      class="dialog-turn-context-menu"
      :style="style"
      role="menu"
      @focusout="onFocusout"
      @keydown.escape.prevent.stop="emit('close')"
      @contextmenu.prevent
      @mousedown.prevent
    >
      <MenuItem
        class="dialog-turn-context-menu__item"
        :label="isSelected ? t('dialog.deselectTurn') : t('dialog.selectTurn')"
        :icon="
          isSelected
            ? 'mdi:checkbox-blank-outline'
            : 'mdi:checkbox-marked-outline'
        "
        @click="selectAction('toggle-select')"
      />
      <MenuItem
        v-if="hasSelection"
        class="dialog-turn-context-menu__item"
        :label="t('dialog.selectRangeUpTo')"
        icon="mdi:select-all"
        @click="selectAction('select-range-up-to')"
      />
      <div class="dialog-turn-context-menu__separator" role="separator" />
      <MenuItem
        class="dialog-turn-context-menu__item"
        :label="t('dialog.copyTurn')"
        icon="mdi:content-copy"
        @click="selectAction('copy-turn')"
      />
      <MenuItem
        v-if="hasTranslation"
        class="dialog-turn-context-menu__item"
        :label="t('dialog.copyTurnTranslation')"
        icon="mdi:translate"
        @click="selectAction('copy-translation')"
      />
    </MenuSurface>
  </Teleport>
</template>

<script setup lang="ts">
import { type CSSProperties, computed, nextTick, onMounted, ref } from 'vue'

import { useI18n } from '../../composables/use-i18n'
import { placeMenu } from '../../lib/editor/menu-placement'
import MenuItem from '../common/MenuItem.vue'
import MenuSurface from '../common/MenuSurface.vue'

const props = defineProps<{
  x: number
  y: number
  isSelected: boolean
  hasSelection: boolean
  hasTranslation: boolean
}>()

const emit = defineEmits<{
  (
    e: 'action',
    action:
      'toggle-select' | 'select-range-up-to' | 'copy-turn' | 'copy-translation'
  ): void
  (e: 'close'): void
}>()

const { t } = useI18n()
const menuSurfaceRef = ref<InstanceType<typeof MenuSurface> | null>(null)
const position = ref({ x: props.x, y: props.y })
const isPlaced = ref(false)

const style = computed<CSSProperties>(() => ({
  position: 'fixed',
  left: `${position.value.x}px`,
  top: `${position.value.y}px`,
  visibility: isPlaced.value ? 'visible' : 'hidden',
  zIndex: 'var(--z-context-menu, 9999)',
}))

const place = (): void => {
  const el = menuSurfaceRef.value?.$el as HTMLElement | undefined
  if (!el) return

  const { width, height } = el.getBoundingClientRect()
  position.value = placeMenu(
    { x: props.x, y: props.y },
    { width, height },
    'point',
    { width: window.innerWidth, height: window.innerHeight }
  )
  isPlaced.value = true
}

const onFocusout = (event: FocusEvent): void => {
  const next = event.relatedTarget as Node | null
  const el = menuSurfaceRef.value?.$el as HTMLElement | undefined
  if (el && next && el.contains(next)) return
  emit('close')
}

function selectAction(
  action:
    'toggle-select' | 'select-range-up-to' | 'copy-turn' | 'copy-translation'
) {
  emit('action', action)
  emit('close')
}

onMounted(async () => {
  await nextTick()
  place()
  const el = menuSurfaceRef.value?.$el as HTMLElement | undefined
  el?.focus()
})
</script>

<style scoped>
.dialog-turn-context-menu {
  min-width: 13rem;
  padding: var(--space-2xs);
  display: flex;
  flex-direction: column;
  gap: var(--space-3xs);
}

.dialog-turn-context-menu__separator {
  height: 1px;
  margin: var(--space-3xs) var(--space-2xs);
  background: var(--app-border-subtle);
}
</style>
