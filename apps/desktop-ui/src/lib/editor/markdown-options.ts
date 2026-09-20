import type { Options as RemarkStringifyOptions } from 'remark-stringify'

/**
 * Intra-word underscores do not start emphasis in CommonMark, but
 * remark-stringify escapes them anyway. This buffer is plain text the user
 * reads and that is later sent to an LLM, so the backslashes are pure noise
 */
const INTRAWORD_UNDERSCORE = /(?<=[\p{L}\p{N}])\\_(?=[\p{L}\p{N}])/gu

/**
 * Single markdown serialization setup for the whole application: both for the
 * "tidy up markdown" button (`useCodeFormatter.formatMdAndStyle`) and for
 * converting clipboard HTML. Otherwise one document would end up with `-` and
 * `*` bullets at the same time
 */
export const MARKDOWN_STRINGIFY_OPTIONS: RemarkStringifyOptions = {
  bullet: '-',
  handlers: {
    // keep the standard escaping, only drop the intra-word underscore case
    text: (node, _parent, state, info) =>
      state.safe(node.value, info).replace(INTRAWORD_UNDERSCORE, '_'),
  },
}
