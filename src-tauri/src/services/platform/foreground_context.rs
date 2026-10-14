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

#[allow(async_fn_in_trait)]
pub(crate) trait ForegroundContext {
    fn capture_source(&self) -> Option<ForegroundTarget>;
    async fn capture_selection(&self, target: Option<ForegroundTarget>) -> Option<String>;
}

struct SystemForegroundContext;

impl ForegroundContext for SystemForegroundContext {
    fn capture_source(&self) -> Option<ForegroundTarget> {
        capture_source_impl().map(ForegroundTarget::from_platform_id)
    }

    async fn capture_selection(&self, target: Option<ForegroundTarget>) -> Option<String> {
        capture_selection_impl(target.map(ForegroundTarget::into_platform_id)).await
    }
}

pub fn capture_source() -> Option<ForegroundTarget> {
    SystemForegroundContext.capture_source()
}

pub async fn capture_selection(target: Option<ForegroundTarget>) -> Option<String> {
    SystemForegroundContext.capture_selection(target).await
}

#[cfg(target_os = "linux")]
fn capture_source_impl() -> Option<String> {
    super::linux::capture_source()
}

#[cfg(target_os = "linux")]
async fn capture_selection_impl(source: Option<String>) -> Option<String> {
    super::linux::capture_selection(source).await
}

#[cfg(target_os = "windows")]
fn capture_source_impl() -> Option<String> {
    super::windows::capture_source()
}

#[cfg(target_os = "windows")]
async fn capture_selection_impl(source: Option<String>) -> Option<String> {
    super::windows::capture_selection(source).await
}

#[cfg(target_os = "macos")]
fn capture_source_impl() -> Option<String> {
    super::macos::capture_source()
}

#[cfg(target_os = "macos")]
async fn capture_selection_impl(source: Option<String>) -> Option<String> {
    super::macos::capture_selection(source).await
}
