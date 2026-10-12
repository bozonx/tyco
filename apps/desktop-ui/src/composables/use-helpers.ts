export const useHelpers = () => {
  const resetGlobalFocus = () => {
    const activeElement = document.activeElement
    if (
      activeElement instanceof HTMLElement ||
      activeElement instanceof SVGElement
    ) {
      activeElement.blur()
    }
  }

  return { resetGlobalFocus }
}
