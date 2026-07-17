use serde::{Deserialize, Serialize};
use std::collections::HashSet;
use std::path::{Path, PathBuf};
use tokio::sync::Mutex as TokioMutex;

const EXTERNAL_BACKEND_ID: &str = "external";
const EXTERNAL_BACKEND_NAME: &str = "External STT";
const EXTERNAL_BACKEND_SENTINEL_PATH: &str = "__acepe_external_stt_backend__";
const EXTERNAL_STT_COMMAND_ENV: &str = "ACEPE_VOICE_STT_COMMAND";
const EXTERNAL_STT_MODEL_PATH_ENV: &str = "ACEPE_VOICE_STT_MODEL_PATH";

#[derive(Debug, Clone, Serialize, Deserialize, specta::Type)]
pub struct ModelInfo {
    pub id: String,
    pub name: String,
    pub size_bytes: u64,
    pub is_english_only: bool,
    pub is_downloaded: bool,
    pub is_loaded: bool,
    pub download_url: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, specta::Type)]
pub struct ModelDownloadProgress {
    pub model_id: String,
    pub downloaded_bytes: u64,
    pub total_bytes: u64,
    pub percent: f32,
}

#[derive(Debug, Clone, Serialize, Deserialize, specta::Type)]
pub struct ModelDownloadComplete {
    pub model_id: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, specta::Type)]
pub struct ModelDownloadError {
    pub model_id: String,
    pub message: String,
}

pub struct ModelManager {
    downloading: TokioMutex<HashSet<String>>,
}

impl ModelManager {
    pub fn new(_app_data_dir: &Path) -> Self {
        Self {
            downloading: TokioMutex::new(HashSet::new()),
        }
    }

    pub fn list_models(&self) -> Vec<ModelInfo> {
        vec![self.external_model_info()]
    }

    pub fn is_model_available(&self, model_id: &str) -> bool {
        self.is_external_backend_id(model_id) && external_command_configured()
    }

    pub fn is_model_available_fast(&self, model_id: &str) -> bool {
        self.is_model_available(model_id)
    }

    pub fn model_path(&self, model_id: &str) -> Option<PathBuf> {
        self.is_external_backend_id(model_id)
            .then(|| PathBuf::from(EXTERNAL_BACKEND_SENTINEL_PATH))
    }

    pub fn validate_model(&self, model_id: &str, _path: &Path) -> anyhow::Result<()> {
        Self::validate_model_id(model_id)
    }

    pub fn validate_model_id(model_id: &str) -> anyhow::Result<()> {
        if model_id.trim().is_empty() {
            anyhow::bail!("Unknown voice backend");
        }

        Ok(())
    }

    pub fn validate_url(_url: &reqwest::Url) -> bool {
        false
    }

    pub fn get_model_info(&self, model_id: &str) -> anyhow::Result<ModelInfo> {
        Self::validate_model_id(model_id)?;
        Ok(self.external_model_info())
    }

    pub fn delete_model(&self, model_id: &str) -> anyhow::Result<()> {
        Self::validate_model_id(model_id)?;
        tracing::info!(
            model_id,
            "ModelManager: delete ignored for external backend"
        );
        Ok(())
    }

    pub async fn download_model<F>(
        &self,
        model_id: &str,
        _emit_progress: F,
    ) -> anyhow::Result<PathBuf>
    where
        F: FnMut(ModelDownloadProgress),
    {
        Self::validate_model_id(model_id)?;
        {
            let mut active = self.downloading.lock().await;
            if !active.insert(model_id.to_string()) {
                anyhow::bail!("Voice backend '{}' is already being configured", model_id);
            }
        }
        {
            let mut active = self.downloading.lock().await;
            active.remove(model_id);
        }

        anyhow::bail!(
            "Voice models are managed outside Acepe. Configure {} and optionally {}.",
            EXTERNAL_STT_COMMAND_ENV,
            EXTERNAL_STT_MODEL_PATH_ENV
        )
    }

    fn external_model_info(&self) -> ModelInfo {
        ModelInfo {
            id: EXTERNAL_BACKEND_ID.to_string(),
            name: EXTERNAL_BACKEND_NAME.to_string(),
            size_bytes: 0,
            is_english_only: false,
            is_downloaded: external_command_configured(),
            is_loaded: false,
            download_url: String::new(),
        }
    }

    fn is_external_backend_id(&self, model_id: &str) -> bool {
        model_id == EXTERNAL_BACKEND_ID || !model_id.trim().is_empty()
    }
}

pub fn validate_model_file(model_id: &str, _path: &Path) -> anyhow::Result<()> {
    ModelManager::validate_model_id(model_id)
}

fn external_command_configured() -> bool {
    std::env::var(EXTERNAL_STT_COMMAND_ENV)
        .ok()
        .filter(|value| !value.trim().is_empty())
        .map(PathBuf::from)
        .is_some_and(|path| path.exists())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn exposes_one_external_backend_row() {
        let manager = ModelManager::new(Path::new("/tmp/acepe"));

        let models = manager.list_models();

        assert_eq!(models.len(), 1);
        assert_eq!(models[0].id, EXTERNAL_BACKEND_ID);
        assert_eq!(models[0].name, EXTERNAL_BACKEND_NAME);
    }

    #[test]
    fn accepts_legacy_selected_model_ids_as_external_backend_aliases() {
        let manager = ModelManager::new(Path::new("/tmp/acepe"));

        assert!(manager.model_path("small.en").is_some());
        assert!(manager.get_model_info("small.en").is_ok());
    }
}
