export function isMacPlatform(): boolean {
  return (
    typeof navigator !== 'undefined' &&
    /Mac|iPhone|iPad|iPod/i.test(
      navigator.userAgent ||
        (navigator as unknown as { platform?: string }).platform ||
        ''
    )
  )
}

/** Formats Mod shortcuts appropriately for macOS or Windows/Linux */
export function adaptModShortcuts(text: string, forceMac?: boolean): string {
  const mac = forceMac ?? isMacPlatform()
  if (!mac) return text
  return text
    .replace(/\bCtrl\+/g, 'Cmd+')
    .replace(/\bStrg\+/g, 'Cmd+')
    .replace(/\bCtrl\b/g, 'Cmd')
}
