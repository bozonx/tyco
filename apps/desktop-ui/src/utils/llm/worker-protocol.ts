export type WorkerResponse =
  | { type: 'init-ok'; id: number }
  | {
      type: 'progress'
      id: number
      data: { status: string; file?: string; progress?: number }
    }
  | { type: 'chunk'; id: number; data: { chunk: string } }
  | { type: 'result'; id: number; data: { content: string } }
  | { type: 'aborted'; id: number }
  | { type: 'error'; id: number; error: string }
