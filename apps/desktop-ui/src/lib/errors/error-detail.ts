/** Longer details, e.g. a provider's response body, are cut to this length */
export const MAX_ERROR_DETAIL_CHARACTERS = 500

/** A localized summary, then the raw detail on its own line when there is one */
export function withErrorDetail(summary: string, rawDetail: string): string {
  const trimmed = rawDetail.trim()
  const detail =
    trimmed.length > MAX_ERROR_DETAIL_CHARACTERS
      ? `${trimmed.slice(0, MAX_ERROR_DETAIL_CHARACTERS).trimEnd()}…`
      : trimmed
  return detail && detail !== summary ? `${summary}\n${detail}` : summary
}
