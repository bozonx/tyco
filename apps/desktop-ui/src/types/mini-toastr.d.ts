declare module 'mini-toastr' {
  interface ToastrOptions {
    type?: 'success' | 'error' | 'warning' | 'info'
    title?: string
    message?: string
    timeout?: number
    cb?: () => void
  }

  interface Toastr {
    success(
      message: string,
      title?: string,
      timeoutOverride?: number,
      cb?: () => void
    ): void
    error(
      message: string,
      title?: string,
      timeoutOverride?: number,
      cb?: () => void
    ): void
    warning(
      message: string,
      title?: string,
      timeoutOverride?: number,
      cb?: () => void
    ): void
    warn(
      message: string,
      title?: string,
      timeoutOverride?: number,
      cb?: () => void
    ): void
    info(
      message: string,
      title?: string,
      timeoutOverride?: number,
      cb?: () => void
    ): void
    show(message: string, title?: string, options?: ToastrOptions): void
    config(options: ToastrOptions): void
    init(options: { timeout?: number }): void
  }

  const toastr: Toastr
  export default toastr
}
