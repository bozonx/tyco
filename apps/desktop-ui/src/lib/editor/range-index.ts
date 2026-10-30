/** A `[from, to)` span of a document */
export interface TextRange {
  from: number
  to: number
}

/**
 * Answers overlap questions about a set of ranges in logarithmic time: a
 * document has thousands of hidden marks, and comparing each of them with every
 * replaced block made typing in a long text quadratic.
 */
export const createRangeIndex = (ranges: readonly TextRange[]) => {
  const sorted = [...ranges].sort((a, b) => a.from - b.from)
  // maxTo[i]: the furthest end among the first i ranges
  const maxTo = [-Infinity]
  for (const range of sorted) maxTo.push(Math.max(maxTo.at(-1)!, range.to))
  /** How many ranges start before `pos` (or at it, when `inclusive`) */
  const countStarting = (pos: number, inclusive: boolean): number => {
    let low = 0
    let high = sorted.length
    while (low < high) {
      const mid = (low + high) >> 1
      const from = sorted[mid]!.from
      if (from < pos || (inclusive && from === pos)) low = mid + 1
      else high = mid
    }
    return low
  }

  return {
    /** Some range shares a character with `[from, to)` */
    overlaps: (from: number, to: number): boolean =>
      maxTo[countStarting(to, false)]! > from,
    /** Some other range covers `[from, to)` and reaches beyond it */
    containsStrictly: (from: number, to: number): boolean =>
      maxTo[countStarting(from, false)]! >= to ||
      maxTo[countStarting(from, true)]! > to,
  }
}
