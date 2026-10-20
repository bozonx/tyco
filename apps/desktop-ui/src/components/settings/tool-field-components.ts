import type { Component } from 'vue'
import FastNoteToolFields from './FastNoteToolFields.vue'

/**
 * Optional domain-specific editors; the default editor handles every other
 * tool.
 */
export const TOOL_FIELD_COMPONENTS: Readonly<Record<string, Component>> = {
  'FastNote.write': FastNoteToolFields,
}
