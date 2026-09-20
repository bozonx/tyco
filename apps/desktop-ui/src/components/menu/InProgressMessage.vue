<template>
  <div class="flex flex-col w-full h-full justify-center items-center">
    <h2>
      <span v-if="props.ai">{{ t('menu.aiRequest') }} </span>
      <span v-else-if="props.correction">{{ t('menu.correction') }} </span>
      <span v-else>{{ t('common.inProgress') }} </span>

      <span class="loading loading-spinner loading-lg"></span>
    </h2>
  </div>
</template>

<script setup lang="ts">
import { useI18n } from '../../composables/useI18n'

const props = withDefaults(
  defineProps<{
    ai?: boolean
    correction?: boolean
  }>(),
  {
    ai: false,
    correction: false,
  }
)

const { t } = useI18n()
</script>
