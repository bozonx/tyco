const WRAPPER_TAG_PATTERN =
  /^<(untrusted_content|translation|source_text|text|result|output)\b[^>]*>\s*([\s\S]*?)\s*<\/\1>$/i
const FENCE_PATTERN = /^```[a-zA-Z0-9_-]*\r?\n([\s\S]*?)\r?\n```$/
/** A lead-in like "Here is the corrected text:", in English or Russian */
const PREAMBLE_PATTERN =
  /^(?:(?:here(?:'s| is) (?:the |your )?(?:\w+ )?(?:text|translation|version|result)|(?:corrected|restyled|rewritten|transformed|translated) text|translation|result|(?:вот )?(?:исправленный|переработанный|переведённый|переведенный) текст|перевод|результат)\s*:[ \t]*\r?\n?)/i

/**
 * The text an LLM task returned, without the wrapping a model adds on its own:
 * a wrapper tag, a code fence or a lead-in. Each is kept when the source text
 * itself starts that way. An output without any is returned unchanged
 */
export function cleanLlmOutput(output: string, source: string): string {
  let cleaned = output.trim()
  const trimmedSource = source.trim()
  let isChanged = false

  const tagMatch = cleaned.match(WRAPPER_TAG_PATTERN)
  if (tagMatch && !new RegExp(`<${tagMatch[1]}\\b`, 'i').test(source)) {
    cleaned = tagMatch[2]!.trim()
    isChanged = true
  }

  const fenceMatch = cleaned.match(FENCE_PATTERN)
  if (fenceMatch && !trimmedSource.startsWith('```')) {
    cleaned = fenceMatch[1]!.trim()
    isChanged = true
  }

  const preambleMatch = cleaned.match(PREAMBLE_PATTERN)
  if (
    preambleMatch &&
    !PREAMBLE_PATTERN.test(trimmedSource) &&
    cleaned.length > preambleMatch[0].length
  ) {
    cleaned = cleaned.slice(preambleMatch[0].length).trim()
    isChanged = true
  }

  return isChanged ? cleaned : output
}
