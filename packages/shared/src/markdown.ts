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

export interface MarkdownCleanSettings {
  bullet: '-' | '*' | 'none'
  codeBlockIndent: 'none' | '2spaces' | '4spaces' | 'tab'
  blockquoteIndent: 'none' | '2spaces' | '4spaces' | 'tab' | 'angle'
  keepInlineCode: boolean
  linkFormat: 'text' | 'textAndUrl' | 'url'
  imageFormat: 'alt' | 'altAndUrl' | 'url' | 'none'
  keepThematicBreaks: boolean
  keepTaskCheckboxes: boolean
}

export const DEFAULT_MARKDOWN_CLEAN_SETTINGS: MarkdownCleanSettings = {
  bullet: '-',
  codeBlockIndent: 'none',
  blockquoteIndent: 'none',
  keepInlineCode: false,
  linkFormat: 'text',
  imageFormat: 'alt',
  keepThematicBreaks: true,
  keepTaskCheckboxes: true,
}

export function normalizeMarkdownCleanSettings(
  value: unknown
): MarkdownCleanSettings {
  const input = (
    value && typeof value === 'object' ? value : {}
  ) as Partial<MarkdownCleanSettings>
  return {
    bullet: ['-', '*', 'none'].includes(input.bullet ?? '')
      ? input.bullet!
      : DEFAULT_MARKDOWN_CLEAN_SETTINGS.bullet,
    codeBlockIndent: ['none', '2spaces', '4spaces', 'tab'].includes(
      input.codeBlockIndent ?? ''
    )
      ? input.codeBlockIndent!
      : DEFAULT_MARKDOWN_CLEAN_SETTINGS.codeBlockIndent,
    blockquoteIndent: ['none', '2spaces', '4spaces', 'tab', 'angle'].includes(
      input.blockquoteIndent ?? ''
    )
      ? input.blockquoteIndent!
      : DEFAULT_MARKDOWN_CLEAN_SETTINGS.blockquoteIndent,
    keepInlineCode: input.keepInlineCode === true,
    linkFormat: ['text', 'textAndUrl', 'url'].includes(input.linkFormat ?? '')
      ? input.linkFormat!
      : DEFAULT_MARKDOWN_CLEAN_SETTINGS.linkFormat,
    imageFormat: ['alt', 'altAndUrl', 'url', 'none'].includes(
      input.imageFormat ?? ''
    )
      ? input.imageFormat!
      : DEFAULT_MARKDOWN_CLEAN_SETTINGS.imageFormat,
    keepThematicBreaks: input.keepThematicBreaks !== false,
    keepTaskCheckboxes: input.keepTaskCheckboxes !== false,
  }
}
