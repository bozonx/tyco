import type { InjectionKey } from 'vue'

export type PreviewAppearance = 'framed' | 'plain'
export const previewAppearanceKey: InjectionKey<PreviewAppearance> =
  Symbol('preview-appearance')
