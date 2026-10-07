export interface MarkdownSettings {
  bullet: '-' | '*' | '+'
  emphasis: '*' | '_'
  strong: '*' | '_'
  headingStyle: 'atx' | 'setext'
  incrementListMarker: boolean
}

export const DEFAULT_MARKDOWN_SETTINGS: MarkdownSettings = {
  bullet: '-',
  emphasis: '*',
  strong: '*',
  headingStyle: 'atx',
  incrementListMarker: true,
}

export function normalizeMarkdownSettings(value: unknown): MarkdownSettings {
  const input = (
    value && typeof value === 'object' ? value : {}
  ) as Partial<MarkdownSettings>
  return {
    bullet: ['-', '*', '+'].includes(input.bullet ?? '') ? input.bullet! : '-',
    emphasis: input.emphasis === '_' ? '_' : '*',
    strong: input.strong === '_' ? '_' : '*',
    headingStyle: input.headingStyle === 'setext' ? 'setext' : 'atx',
    incrementListMarker: input.incrementListMarker !== false,
  }
}
