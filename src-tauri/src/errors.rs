use serde::Serialize;
use thiserror::Error;
use ts_rs::TS;

/// Why a command failed. The variant decides the code the webview sees, so
/// pick the one that tells it what it could do about the failure.
#[derive(Debug, Error)]
pub enum AppError {
    /// The operation failed for a reason the app cannot name better, e.g. a
    /// system tool that reported an error.
    #[error("{0}")]
    Failed(String),
    /// The config changed since the request read it.
    #[error("{0}")]
    ConfigConflict(String),
    /// What the operation needs is not there now: a device, a window, the
    /// system keychain, or the app is stopping.
    #[error("{0}")]
    ServiceUnavailable(String),
    /// Another operation holds what this one needs; it may succeed later.
    #[error("{0}")]
    Busy(String),
    /// The user or the system did not allow the operation.
    #[error("{0}")]
    PermissionDenied(String),
    /// A bound is reached, e.g. a queue or the memory of the session.
    #[error("{0}")]
    ResourceLimit(String),
    /// The request itself is wrong.
    #[error("{0}")]
    InvalidInput(String),
    /// What the request names does not exist.
    #[error("{0}")]
    NotFound(String),
    /// A file is larger than the operation accepts.
    #[error("{0}")]
    FileTooLarge(String),
    /// Stored or received data is malformed.
    #[error("{0}")]
    InvalidData(String),
    #[error("{0}")]
    UnsupportedConfig(String),
    /// The request was made for a state that has changed since, e.g. an
    /// activation a newer one replaced.
    #[error("{0}")]
    Stale(String),
    #[error(transparent)]
    Tauri(#[from] tauri::Error),
    #[error(transparent)]
    Io(#[from] std::io::Error),
    #[error(transparent)]
    Json(#[from] serde_json::Error),
}

macro_rules! error_codes {
    ($($(#[$doc:meta])* $code:ident),* $(,)?) => {
        /// What went wrong with a desktop command, for the webview to decide
        /// on; the message is for people.
        #[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, TS)]
        #[serde(rename_all = "camelCase")]
        #[ts(rename = "DesktopErrorCode")]
        pub enum ErrorCode {
            $($(#[$doc])* $code),*
        }

        impl ErrorCode {
            #[cfg(test)]
            pub const ALL: &'static [ErrorCode] = &[$(ErrorCode::$code),*];
        }
    };
}

error_codes! {
    /// The operation failed; only the message says why.
    OperationFailed,
    /// The config changed since the request read it: read it and try again.
    ConfigConflict,
    /// What the operation needs is not there now.
    ServiceUnavailable,
    /// Another operation holds what this one needs; it may succeed later.
    Busy,
    /// The user or the system did not allow the operation.
    PermissionDenied,
    /// A bound is reached.
    ResourceLimit,
    /// The request itself is wrong.
    InvalidInput,
    /// What the request names does not exist.
    NotFound,
    /// A file is larger than the operation accepts.
    FileTooLarge,
    /// The config was written by a newer version of the app.
    UnsupportedConfig,
    /// The request was made for a state that has changed since.
    Stale,
    /// The runtime of the app failed.
    RuntimeError,
    /// Reading or writing a file failed.
    IoError,
    /// Stored or received data is malformed.
    InvalidData,
}

impl AppError {
    pub fn code(&self) -> ErrorCode {
        match self {
            Self::Failed(_) => ErrorCode::OperationFailed,
            Self::ConfigConflict(_) => ErrorCode::ConfigConflict,
            Self::ServiceUnavailable(_) => ErrorCode::ServiceUnavailable,
            Self::Busy(_) => ErrorCode::Busy,
            Self::PermissionDenied(_) => ErrorCode::PermissionDenied,
            Self::ResourceLimit(_) => ErrorCode::ResourceLimit,
            Self::InvalidInput(_) => ErrorCode::InvalidInput,
            Self::NotFound(_) => ErrorCode::NotFound,
            Self::FileTooLarge(_) => ErrorCode::FileTooLarge,
            Self::InvalidData(_) | Self::Json(_) => ErrorCode::InvalidData,
            Self::UnsupportedConfig(_) => ErrorCode::UnsupportedConfig,
            Self::Stale(_) => ErrorCode::Stale,
            Self::Tauri(_) => ErrorCode::RuntimeError,
            Self::Io(_) => ErrorCode::IoError,
        }
    }
}

/// How every failed command reaches the webview.
#[derive(Serialize, TS)]
#[ts(rename = "DesktopErrorPayload")]
pub struct ErrorPayload {
    pub code: ErrorCode,
    pub message: String,
}

impl Serialize for AppError {
    fn serialize<S>(&self, serializer: S) -> Result<S::Ok, S::Error>
    where
        S: serde::Serializer,
    {
        ErrorPayload {
            code: self.code(),
            message: self.to_string(),
        }
        .serialize(serializer)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn ipc_errors_preserve_codes_and_readable_messages() {
        let json_err = serde_json::from_str::<serde_json::Value>("{").unwrap_err();

        for (error, code) in [
            (
                AppError::Failed("Generic failure".into()),
                "operationFailed",
            ),
            (AppError::Busy("Clipboard is busy".into()), "busy"),
            (
                AppError::PermissionDenied("Accessibility is off".into()),
                "permissionDenied",
            ),
            (AppError::NotFound("Chat not found".into()), "notFound"),
            (
                AppError::InvalidData("Corrupted image".into()),
                "invalidData",
            ),
            (
                AppError::ConfigConflict("Changed in another window".into()),
                "configConflict",
            ),
            (
                AppError::ServiceUnavailable("Keychain is locked".into()),
                "serviceUnavailable",
            ),
            (
                AppError::ResourceLimit("Queue is full".into()),
                "resourceLimit",
            ),
            (
                AppError::InvalidInput("Invalid argument".into()),
                "invalidInput",
            ),
            (
                AppError::FileTooLarge("File size limit exceeded".into()),
                "fileTooLarge",
            ),
            (
                AppError::UnsupportedConfig("Config version 99".into()),
                "unsupportedConfig",
            ),
            (AppError::Stale("Activation changed".into()), "stale"),
            (
                AppError::Io(std::io::Error::new(
                    std::io::ErrorKind::PermissionDenied,
                    "Denied",
                )),
                "ioError",
            ),
            (AppError::Json(json_err), "invalidData"),
        ] {
            assert_eq!(
                serde_json::to_value(&error).unwrap(),
                serde_json::json!({"code": code, "message": error.to_string()})
            );
        }
    }
}
