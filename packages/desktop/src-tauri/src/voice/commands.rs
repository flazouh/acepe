use super::events::{
    VOICE_AMPLITUDE_EVENT, VOICE_MODEL_DOWNLOAD_COMPLETE_EVENT, VOICE_MODEL_DOWNLOAD_ERROR_EVENT,
    VOICE_MODEL_DOWNLOAD_PROGRESS_EVENT, VOICE_RECORDING_ERROR_EVENT,
    VOICE_TRANSCRIPTION_COMPLETE_EVENT, VOICE_TRANSCRIPTION_ERROR_EVENT,
};
use super::models::{ModelDownloadComplete, ModelDownloadError, ModelInfo};
use super::runtime::{TranscriptionCompletePayload, TranscriptionErrorPayload};
use super::VoiceState;
use serde::{Deserialize, Serialize};
use std::path::PathBuf;
use tauri::{AppHandle, Emitter, State};

fn resolve_verified_model_path(
    state: &VoiceState,
    model_id: &str,
) -> Result<PathBuf, String> {
    let path: PathBuf = state
        .model_manager()
        .model_path(model_id)
        .ok_or_else(|| format!("Unknown model: {}", model_id))?;

    if !path.exists() {
        return Err(format!(
            "Model '{}' is not downloaded. Download it first.",
            model_id
        ));
    }

    state
        .model_manager()
        .validate_model(model_id, &path)
        .map_err(|error| error.to_string())?;

    Ok(path)
}

#[derive(Debug, Clone, Serialize, Deserialize, specta::Type)]
pub struct VoiceLanguageOption {
    pub code: String,
    pub name: String,
}

fn title_case_language_name(name: &str) -> String {
    let mut result = String::new();
    for (index, word) in name.split_whitespace().enumerate() {
        if index > 0 {
            result.push(' ');
        }

        let mut chars = word.chars();
        if let Some(first) = chars.next() {
            result.extend(first.to_uppercase());
            result.push_str(chars.as_str());
        }
    }
    result
}

#[tauri::command]
#[specta::specta]
pub async fn voice_list_models(state: State<'_, VoiceState>) -> Result<Vec<ModelInfo>, String> {
    Ok(state.model_manager().list_models())
}

#[tauri::command]
#[specta::specta]
pub async fn voice_list_languages() -> Result<Vec<VoiceLanguageOption>, String> {
    let max_language_id = whisper_rs::get_lang_max_id();
    let mut languages = Vec::new();

    for language_id in 0..=max_language_id {
        let code = whisper_rs::get_lang_str(language_id);
        let name = whisper_rs::get_lang_str_full(language_id);
        if let (Some(code), Some(name)) = (code, name) {
            languages.push(VoiceLanguageOption {
                code: code.to_string(),
                name: title_case_language_name(name),
            });
        }
    }

    languages.sort_by(|left, right| left.name.cmp(&right.name));
    Ok(languages)
}

#[tauri::command]
#[specta::specta]
pub async fn voice_get_model_status(
    state: State<'_, VoiceState>,
    model_id: String,
) -> Result<ModelInfo, String> {
    state
        .model_manager()
        .get_model_info(&model_id)
        .map_err(|error| error.to_string())
}

#[tauri::command]
#[specta::specta]
pub async fn voice_download_model(
    state: State<'_, VoiceState>,
    app: AppHandle,
    model_id: String,
) -> Result<(), String> {
    let model_id_for_error = model_id.clone();
    let result = state
        .model_manager()
        .download_model(&model_id, |progress| {
            let _ = app.emit(VOICE_MODEL_DOWNLOAD_PROGRESS_EVENT, progress);
        })
        .await;

    match result {
        Ok(_) => {
            let _ = app.emit(
                VOICE_MODEL_DOWNLOAD_COMPLETE_EVENT,
                ModelDownloadComplete { model_id },
            );
            Ok(())
        }
        Err(error) => {
            let message = error.to_string();
            let _ = app.emit(
                VOICE_MODEL_DOWNLOAD_ERROR_EVENT,
                ModelDownloadError {
                    model_id: model_id_for_error,
                    message: message.clone(),
                },
            );
            Err(message)
        }
    }
}

#[tauri::command]
#[specta::specta]
pub async fn voice_delete_model(
    state: State<'_, VoiceState>,
    model_id: String,
) -> Result<(), String> {
    state
        .model_manager()
        .delete_model(&model_id)
        .map_err(|error| error.to_string())
}

#[tauri::command]
#[specta::specta]
pub async fn voice_load_model(
    state: State<'_, VoiceState>,
    model_id: String,
) -> Result<(), String> {
    let path = resolve_verified_model_path(&state, &model_id)?;

    state
        .runtime()
        .load_model(path)
        .await
        .map_err(|e| e.to_string())
}

// ── Recording commands ────────────────────────────────────────────────────

#[tauri::command]
#[specta::specta]
pub async fn voice_start_recording(
    state: State<'_, VoiceState>,
    app: AppHandle,
    session_id: String,
) -> Result<(), String> {
    let app_for_amp = app.clone();
    let app_for_err = app.clone();

    state
        .runtime()
        .start_recording(
            session_id,
            move |payload| {
                let _ = app_for_amp.emit(VOICE_AMPLITUDE_EVENT, payload);
            },
            move |payload| {
                let _ = app_for_err.emit(VOICE_RECORDING_ERROR_EVENT, payload);
            },
        )
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
#[specta::specta]
pub async fn voice_stop_recording(
    state: State<'_, VoiceState>,
    app: AppHandle,
    session_id: String,
    language: Option<String>,
) -> Result<(), String> {
    let result = state
        .runtime()
        .stop_recording(session_id.clone(), language)
        .await;

    match result {
        Ok(r) => {
            let _ = app.emit(
                VOICE_TRANSCRIPTION_COMPLETE_EVENT,
                TranscriptionCompletePayload {
                    session_id,
                    text: r.text,
                    language: r.language,
                    duration_ms: r.duration_ms,
                },
            );
            Ok(())
        }
        Err(e) => {
            let message = e.to_string();
            let _ = app.emit(
                VOICE_TRANSCRIPTION_ERROR_EVENT,
                TranscriptionErrorPayload {
                    session_id,
                    message: message.clone(),
                },
            );
            Err(message)
        }
    }
}

#[tauri::command]
#[specta::specta]
pub async fn voice_cancel_recording(
    state: State<'_, VoiceState>,
    session_id: String,
) -> Result<(), String> {
    state
        .runtime()
        .cancel_recording(session_id)
        .await
        .map_err(|e| e.to_string())
}
