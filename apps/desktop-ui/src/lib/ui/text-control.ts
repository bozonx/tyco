export interface TextSelection {
  start: number
  end: number
}

export interface TextControl {
  focus: () => void
  isFocused: () => boolean
  getSelection: () => TextSelection | null
  select: (start?: number, end?: number) => void
}
