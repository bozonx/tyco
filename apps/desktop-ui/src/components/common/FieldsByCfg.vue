<template>
  <div>
    <FieldRow
      v-for="item in config"
      :key="item.name"
      :label="item.labelKey ? t(item.labelKey) : item.label || item.name"
    >
      <FieldInput
        v-if="item.type === 'text'"
        v-model:value="values[item.name]"
        @update:value="updateValue(item.name, $event)"
      />
      <FieldTextArea
        v-else-if="item.type === 'textarea'"
        v-model:value="values[item.name]"
        @update:value="updateValue(item.name, $event)"
      />
      <FieldCheckbox
        v-else-if="item.type === 'checkbox'"
        v-model:value="values[item.name]"
        @update:value="updateValue(item.name, $event)"
      />
    </FieldRow>
  </div>
</template>

<script setup lang="ts">
import { InputConfigItem } from 'src/types/index'
import { computed, ref } from 'vue'

import { useI18n } from '../../composables/useI18n'

const props = defineProps<{
  config: InputConfigItem[]
}>()

const emit = defineEmits<{
  (e: 'update:values', values: Record<string, any>): void
}>()

const { t } = useI18n()
const config = computed(() => props.config)
const values = ref<Record<string, any>>({})

config.value.forEach((item: InputConfigItem) => {
  values.value[item.name] = item.value || item.defaultValue
})

function updateValue(_name: string, _value: any) {
  emit('update:values', values.value)
}
</script>
