/// An opaque foreground target: a window ID on Linux, HWND on Windows,
/// or application PID on macOS. Strings are used only at platform and wire boundaries.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct ForegroundTarget(String);

impl ForegroundTarget {
    pub fn from_platform_id(platform_id: String) -> Self {
        Self(platform_id)
    }

    pub fn as_platform_id(&self) -> &str {
        &self.0
    }

    pub fn into_platform_id(self) -> String {
        self.0
    }
}

pub fn capture_foreground_target() -> Option<ForegroundTarget> {
    capture_foreground_target_impl().map(ForegroundTarget::from_platform_id)
}

/// Best-effort return of keyboard focus to `target` after a quick overlay is
/// explicitly dismissed without pasting.
pub fn restore_foreground_target(target: &ForegroundTarget) {
    restore_foreground_target_impl(target.as_platform_id());
}

/// Gives `target` the focus before Tyco hides the window a paste starts from,
/// where the system lets only the foreground process hand the focus over
/// (Windows). Elsewhere the paste activates the target itself.
pub fn focus_paste_target(target: &ForegroundTarget) {
    #[cfg(target_os = "windows")]
    super::windows::focus_paste_target(target.as_platform_id());
    #[cfg(not(target_os = "windows"))]
    let _ = target;
}

/// Keeps the activation token of the request that is about to show a Tyco
/// window, see `linux::activation_token`. Other systems have none.
pub fn offer_activation_token(token: String) {
    #[cfg(target_os = "linux")]
    super::linux::activation_token::offer(token);
    #[cfg(not(target_os = "linux"))]
    let _ = token;
}

/// Whether focus goes back to the target before Tyco hides its window rather
/// than after, see `focus_paste_target`.
pub const RESTORES_FOCUS_BEFORE_HIDING: bool = cfg!(target_os = "windows");

pub async fn capture_selection(target: Option<ForegroundTarget>) -> Option<String> {
    capture_selection_impl(target.map(ForegroundTarget::into_platform_id)).await
}

#[cfg(target_os = "linux")]
fn capture_foreground_target_impl() -> Option<String> {
    super::linux::capture_foreground_target()
}

#[cfg(target_os = "linux")]
fn restore_foreground_target_impl(target: &str) {
    super::linux::restore_foreground_target(target);
}

#[cfg(target_os = "linux")]
async fn capture_selection_impl(target: Option<String>) -> Option<String> {
    super::linux::capture_selection(target).await
}

#[cfg(target_os = "windows")]
fn capture_foreground_target_impl() -> Option<String> {
    super::windows::capture_foreground_target()
}

#[cfg(target_os = "windows")]
fn restore_foreground_target_impl(target: &str) {
    super::windows::restore_foreground_target(target);
}

#[cfg(target_os = "windows")]
async fn capture_selection_impl(target: Option<String>) -> Option<String> {
    super::windows::capture_selection(target).await
}

#[cfg(target_os = "macos")]
fn capture_foreground_target_impl() -> Option<String> {
    super::macos::capture_foreground_target()
}

#[cfg(target_os = "macos")]
fn restore_foreground_target_impl(target: &str) {
    super::macos::restore_foreground_target(target);
}

#[cfg(target_os = "macos")]
async fn capture_selection_impl(target: Option<String>) -> Option<String> {
    super::macos::capture_selection(target).await
}
