export interface HistoryListItem {
  id: string
  value: string
  /** Why the entry is in the history, shown above the text. */
  meta?: {
    icon: string
    label: string
    note?: string
    noteTone?: 'success' | 'error' | 'muted'
    noteIcon?: string
    /** More about the note, e.g. the error text, shown on hover */
    noteDetail?: string
  }
  /** The text `value` was made from, shown collapsed under it. */
  original?: { label: string; text: string }
  /** Unix time in milliseconds; 0 or missing when unknown. */
  time?: number
  /** Additional localized terms included in search. */
  searchText?: string
  /** A file the entry links to, e.g. the recording of a dialog */
  file?: {
    name: string
    /** Gone from where the entry points: no action is offered */
    isMissing: boolean
    missingLabel: string
    /** Said of a file that is there, e.g. that it holds only a part */
    note?: string
    action: HistoryListAction
  }
}

export interface HistoryListAction {
  id: string
  icon: string
  title: string
  danger?: boolean
  isVisible?: (item: HistoryListItem) => boolean
}
