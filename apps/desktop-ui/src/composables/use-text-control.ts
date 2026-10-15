import type { Ref } from 'vue'

import type { TextControl } from '../lib/ui/text-control'

/** The native selection contract shared by text inputs and their adapters. */
export function useTextControl(
  element: Ref<HTMLInputElement | HTMLTextAreaElement | null>
): TextControl {
  return {
    focus: () => element.value?.focus(),
    isFocused: () =>
      element.value !== null &&
      element.value.ownerDocument.activeElement === element.value,
    getSelection: () => {
      const control = element.value
      return control?.selectionStart == null || control.selectionEnd == null
        ? null
        : { start: control.selectionStart, end: control.selectionEnd }
    },
    select: (start, end) => {
      const control = element.value
      if (!control) return
      if (start === undefined && end === undefined) control.select()
      else if (control.selectionStart !== null)
        control.setSelectionRange(start ?? 0, end ?? start ?? 0)
    },
  }
}
