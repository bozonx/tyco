export interface HistoryListItemFile {
  name: string
  /** Gone from where the entry points: no action is offered */
  isMissing: boolean
  missingLabel: string
  /** Said of a file that is there, e.g. that it holds only a part */
  note?: string
  action: HistoryListAction
  /** Plays the file in place; missing when it cannot be played */
  playback?: HistoryFilePlayback
}

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
  file?: HistoryListItemFile
  /** Files the entry links to, if multiple recordings exist */
  files?: HistoryListItemFile[]
}

/** How an entry plays its file with the webview's own player */
export interface HistoryFilePlayback {
  /** The URL to play from, asked for only when the player opens */
  source: () => string
  playTitle: string
  closeTitle: string
  /** Why it cannot play now, e.g. while a dialog records the sound */
  disabledTitle?: string
  unavailableLabel: string
}

export interface HistoryListAction {
  id: string
  icon: string
  title: string
  danger?: boolean
  isVisible?: (item: HistoryListItem) => boolean
}
