export function useTextTransform() {
  const doCaseTransform = (text: string, caseType: string): string => {
    if (caseType === 'uppercase') return text.toUpperCase()
    if (caseType === 'lowercase') return text.toLowerCase()
    return text
  }
  return { doCaseTransform }
}
