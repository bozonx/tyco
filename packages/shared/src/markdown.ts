import configDefaults from './user-config-defaults.json' with { type: 'json' }

/** How the editor writes Markdown, `markdown.format` */
export interface MarkdownFormatSettings {
  bullet: '-' | '*' | '+'
  emphasis: '*' | '_'
  strong: '*' | '_'
  headingStyle: 'atx' | 'setext'
  /** Ordered lists count up; otherwise every item repeats the first number */
  isListMarkerIncremented: boolean
}

/** What is left of the Markdown when it becomes plain text, `markdown.strip` */
export interface MarkdownStripSettings {
  bullet: '-' | '*' | 'none'
  codeBlockIndent: 'none' | '2spaces' | '4spaces' | 'tab'
  blockquoteIndent: 'none' | '2spaces' | '4spaces' | 'tab' | 'angle'
  /** The text keeps the backticks of inline code */
  hasInlineCode: boolean
  linkFormat: 'text' | 'textAndUrl' | 'url'
  imageFormat: 'alt' | 'altAndUrl' | 'url' | 'none'
  hasThematicBreaks: boolean
  hasTaskCheckboxes: boolean
}

export interface MarkdownConfig {
  format: MarkdownFormatSettings
  strip: MarkdownStripSettings
}

export const DEFAULT_MARKDOWN_CONFIG = configDefaults.markdown as MarkdownConfig
