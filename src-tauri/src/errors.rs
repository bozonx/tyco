use thiserror::Error;

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
    #[error("{0}")]
    UnsupportedConfig(String),
    #[error(transparent)]
    Tauri(#[from] tauri::Error),
    #[error(transparent)]
    Io(#[from] std::io::Error),
    #[error(transparent)]
    Json(#[from] serde_json::Error),
    #[error(transparent)]
    Yaml(#[from] serde_yaml::Error),
}

impl AppError {
    pub fn code(&self) -> &'static str {
        match self {
            Self::Message(_) => "operationFailed",
            Self::ConfigConflict(_) => "configConflict",
            Self::ServiceUnavailable(_) => "serviceUnavailable",
            Self::ResourceLimit(_) => "resourceLimit",
            Self::InvalidInput(_) => "invalidInput",
            Self::UnsupportedConfig(_) => "unsupportedConfig",
            Self::Tauri(_) => "runtimeError",
            Self::Io(_) => "ioError",
            Self::Json(_) | Self::Yaml(_) => "invalidData",
        }
    }
}

impl serde::Serialize for AppError {
    fn serialize<S>(&self, serializer: S) -> Result<S::Ok, S::Error>
    where
        S: serde::Serializer,
    {
        use serde::ser::SerializeStruct;
        let mut error = serializer.serialize_struct("AppError", 2)?;
        error.serialize_field("code", self.code())?;
        error.serialize_field("message", &self.to_string())?;
        error.end()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn ipc_errors_preserve_codes_and_readable_messages() {
        let json_err = serde_json::from_str::<serde_json::Value>("{").unwrap_err();
        let yaml_err = serde_yaml::from_str::<serde_json::Value>(":").unwrap_err();

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
                AppError::UnsupportedConfig("Config version 99".into()),
                "unsupportedConfig",
            ),
            (
                AppError::Io(std::io::Error::new(
                    std::io::ErrorKind::PermissionDenied,
                    "Denied",
                )),
                "ioError",
            ),
            (AppError::Json(json_err), "invalidData"),
            (AppError::Yaml(yaml_err), "invalidData"),
        ] {
            assert_eq!(
                serde_json::to_value(&error).unwrap(),
                serde_json::json!({"code": code, "message": error.to_string()})
            );
        }
    }
}
