/**
 * Icon sizes in rem, so icons follow interface scaling together with text.
 * Pixel values are the sizes at 100% scale.
 */
export const ICON_SIZES = {
  xs: 0.75, // 12px
  sm: 0.875, // 14px
  md: 1, // 16px
  lg: 1.125, // 18px
  xl: 1.25, // 20px
  '2xl': 1.375, // 22px
  '3xl': 1.75, // 28px
  '4xl': 2, // 32px
} as const

export type IconSize = keyof typeof ICON_SIZES

export function iconSizeLength(size: IconSize): string {
  return `${ICON_SIZES[size]}rem`
}
