use serde::{Deserialize, Serialize};
use thiserror::Error as ThisError;

pub type Result<T> = std::result::Result<T, Error>;

#[derive(ThisError, Debug, Serialize, Deserialize)]
#[serde(tag = "type", content = "message")]
pub enum Error {
    #[error("Window not found: {0}")]
    WindowNotFound(String),

    #[error("Window operation failed: {0}")]
    WindowOperationFailed(String),

    #[error("Plugin initialization error: {0}")]
    PluginInit(String),

    #[error("IO error: {0}")]
    Io(String),

    #[error("{0}")]
    Anyhow(String),

    #[error("Tauri error: {0}")]
    TauriError(String),
}

impl From<std::io::Error> for Error {
    fn from(error: std::io::Error) -> Self {
        Self::Io(error.to_string())
    }
}

impl From<anyhow::Error> for Error {
    fn from(error: anyhow::Error) -> Self {
        Self::Anyhow(error.to_string())
    }
}

impl From<tauri::Error> for Error {
    fn from(error: tauri::Error) -> Self {
        Self::TauriError(error.to_string())
    }
}
