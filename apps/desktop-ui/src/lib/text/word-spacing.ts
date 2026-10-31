/** Scripts written without spaces between words */
const UNSPACED_SCRIPT =
  /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Thai}\p{Script=Lao}\p{Script=Khmer}\p{Script=Myanmar}\u3000-\u303f\uff00-\uffef]/u
/** Punctuation that sticks to the word before it */
const CLOSING_PUNCTUATION =
  /^[.,!?;:…%)\]}»”’\u3001\u3002\u300d\u300f\u3011\uff01\uff09\uff0c\uff1a\uff1b\uff1f]/u
/** Punctuation that sticks to the word after it */
const OPENING_PUNCTUATION = /[([{«“‘¿¡]$/u

const lastChar = (text: string) => Array.from(text.slice(-2)).at(-1) ?? ''
const firstChar = (text: string) =>
  String.fromCodePoint(text.codePointAt(0) ?? 0)

/**
 * Whether two pieces of text joined together need a space between them: not
 * when either side already has whitespace, before closing or after opening
 * punctuation, or between two characters of scripts without spaces.
 */
export function needsSpaceBetween(head: string, tail: string): boolean {
  if (!head || !tail) return false
  if (/\s$/u.test(head) || /^\s/u.test(tail)) return false
  if (CLOSING_PUNCTUATION.test(tail) || OPENING_PUNCTUATION.test(head))
    return false
  const before = lastChar(head)
  const after = firstChar(tail)
  return !(UNSPACED_SCRIPT.test(before) && UNSPACED_SCRIPT.test(after))
}

/** `head` and `tail` as one text, with a space only where words need one */
export function joinWords(head: string, tail: string): string {
  return needsSpaceBetween(head, tail) ? `${head} ${tail}` : `${head}${tail}`
}
