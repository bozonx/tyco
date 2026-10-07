import type { Options as RemarkStringifyOptions } from 'remark-stringify'
import { normalizeMarkdownSettings } from '@tyco/shared'

/**
 * Intra-word underscores do not start emphasis in CommonMark, but
 * remark-stringify escapes them anyway. This buffer is plain text the user
 * reads and that is later sent to an LLM, so the backslashes are pure noise
 */
const INTRAWORD_UNDERSCORE = /(?<=[\p{L}\p{N}])\\_(?=[\p{L}\p{N}])/gu

/** Shared serialization settings for clipboard HTML and the format command. */
export function markdownStringifyOptions(
  value?: unknown
): RemarkStringifyOptions {
  const settings = normalizeMarkdownSettings(value)
  return {
    bullet: settings.bullet,
    emphasis: settings.emphasis,
    strong: settings.strong,
    setext: settings.headingStyle === 'setext',
    incrementListMarker: settings.incrementListMarker,
    handlers: {
      text: (node, _parent, state, info) =>
        state.safe(node.value, info).replace(INTRAWORD_UNDERSCORE, '_'),
    },
  }
}
