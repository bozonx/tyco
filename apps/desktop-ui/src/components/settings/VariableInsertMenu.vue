<template>
  <DropdownMenu
    icon="mdi:variable"
    square
    hide-chevron
    variant="ghost"
    size="sm"
    align="right"
    :label="t('variables.insert')"
    :title="t('variables.insert')"
    :items="items"
    data-testid="insert-variable"
  />
</template>

<script setup lang="ts">
import { computed, inject } from 'vue'

import { useI18n } from '../../composables/use-i18n'
import { SETTINGS_CONTEXT_KEY } from '../../lib/settings/settings-context'
import DropdownMenu, { type DropdownMenuItem } from '../common/DropdownMenu.vue'
import { BUILTIN_VARIABLES, variablePlaceholder } from '@tyco/shared'

/**
 * Offers what a template field takes, in one menu: the placeholders of the run
 * (e.g. `{{TEXT}}`) first, then the declared and the built-in variables as
 * `{{var:NAME}}`
 */
const props = defineProps<{ placeholders?: readonly string[] }>()
const emit = defineEmits<{ insert: [placeholder: string] }>()
const { t } = useI18n()
const context = inject(SETTINGS_CONTEXT_KEY, null)

const items = computed<DropdownMenuItem[]>(() => [
  ...(props.placeholders ?? []).map((placeholder) => ({
    label: placeholder,
    action: () => emit('insert', placeholder),
  })),
  ...[
    ...(context?.draft.value.variables ?? []).map((variable) => variable.name),
    ...BUILTIN_VARIABLES,
  ].map((name) => ({
    label: variablePlaceholder(name),
    action: () => emit('insert', variablePlaceholder(name)),
  })),
  ...(context
    ? [
        {
          label: t('variables.manage'),
          icon: 'mdi:cog-outline',
          action: () => context.navigate('variables'),
        },
      ]
    : []),
])
</script>
