export interface HistoryListItem {
  id: string
  value: string
  /** Why the entry is in the history, shown above the text. */
  meta?: { icon: string; label: string; note?: string }
  /** The text `value` was made from, shown collapsed under it. */
  original?: { label: string; text: string }
  /** Unix time in milliseconds; 0 or missing when unknown. */
  time?: number
  /** Additional localized terms included in search. */
  searchText?: string
}

export interface HistoryListAction {
  id: string
  icon: string
  title: string
  danger?: boolean
  isVisible?: (item: HistoryListItem) => boolean
}
