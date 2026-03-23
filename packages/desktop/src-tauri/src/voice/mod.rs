pub mod commands;
pub mod engine;
pub mod events;
pub mod models;
pub mod runtime;

use std::path::Path;

pub use commands::{
    voice_cancel_recording, voice_delete_model, voice_download_model, voice_get_model_status,
    voice_list_languages, voice_list_models, voice_load_model, voice_start_recording,
    voice_stop_recording,
};
pub use engine::WhisperEngine;
pub use models::ModelManager;
pub use runtime::VoiceRuntimeHandle;

pub struct VoiceState {
    model_manager: ModelManager,
    runtime: VoiceRuntimeHandle,
}

impl VoiceState {
    pub fn new(app_data_dir: &Path) -> anyhow::Result<Self> {
        Ok(Self {
            model_manager: ModelManager::new(app_data_dir),
            runtime: VoiceRuntimeHandle::spawn(Box::new(WhisperEngine::new()))?,
        })
    }

    pub fn model_manager(&self) -> &ModelManager {
        &self.model_manager
    }

    pub fn runtime(&self) -> &VoiceRuntimeHandle {
        &self.runtime
    }
}
