#[allow(async_fn_in_trait)]
pub(crate) trait ForegroundContext {
    fn source(&self) -> Option<String>;
    async fn selection(&self, source: Option<String>) -> Option<String>;
}

struct SystemForegroundContext;

impl ForegroundContext for SystemForegroundContext {
    fn source(&self) -> Option<String> {
        capture_source_impl()
    }

    async fn selection(&self, source: Option<String>) -> Option<String> {
        capture_selection_impl(source).await
    }
}

pub fn capture_source() -> Option<String> {
    SystemForegroundContext.source()
}

pub async fn capture_selection(source: Option<String>) -> Option<String> {
    SystemForegroundContext.selection(source).await
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
async fn capture_selection_impl(_source: Option<String>) -> Option<String> {
    super::windows::capture_selection().await
}

#[cfg(target_os = "macos")]
fn capture_source_impl() -> Option<String> {
    super::macos::capture_source()
}

#[cfg(target_os = "macos")]
async fn capture_selection_impl(_source: Option<String>) -> Option<String> {
    super::macos::capture_selection().await
}
