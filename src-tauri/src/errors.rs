use serde::Serialize;
use thiserror::Error;
use ts_rs::TS;

#[derive(Debug, Error)]
pub enum AppError {
    #[error("{0}")]
    Message(String),
    #[error("{0}")]
    ConfigConflict(String),
    #[error("{0}")]
    ServiceUnavailable(String),
    #[error("{0}")]
    ResourceLimit(String),
    #[error("{0}")]
    InvalidInput(String),
    /// A file is larger than the operation accepts.
    #[error("{0}")]
    FileTooLarge(String),
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
    OperationFailed,
    ConfigConflict,
    ServiceUnavailable,
    ResourceLimit,
    InvalidInput,
    FileTooLarge,
    UnsupportedConfig,
    Stale,
    RuntimeError,
    IoError,
    InvalidData,
}

impl AppError {
    pub fn code(&self) -> ErrorCode {
        match self {
            Self::Message(_) => ErrorCode::OperationFailed,
            Self::ConfigConflict(_) => ErrorCode::ConfigConflict,
            Self::ServiceUnavailable(_) => ErrorCode::ServiceUnavailable,
            Self::ResourceLimit(_) => ErrorCode::ResourceLimit,
            Self::InvalidInput(_) => ErrorCode::InvalidInput,
            Self::FileTooLarge(_) => ErrorCode::FileTooLarge,
            Self::UnsupportedConfig(_) => ErrorCode::UnsupportedConfig,
            Self::Stale(_) => ErrorCode::Stale,
            Self::Tauri(_) => ErrorCode::RuntimeError,
            Self::Io(_) => ErrorCode::IoError,
            Self::Json(_) => ErrorCode::InvalidData,
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
                AppError::Message("Generic failure".into()),
                "operationFailed",
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
