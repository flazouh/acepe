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

fn preview_text(text: &str) -> String {
    let normalized = text.split_whitespace().collect::<Vec<_>>().join(" ");
    if normalized.len() <= 120 {
        return normalized;
    }
    format!("{}...", &normalized[..120])
}

async fn resolve_verified_model_path(
    state: &VoiceState,
    model_id: &str,
) -> Result<PathBuf, String> {
    tracing::debug!(model_id, "resolving verified model path");
    let path: PathBuf = state
        .model_manager()
        .model_path(model_id)
        .ok_or_else(|| format!("Unknown model: {}", model_id))?;

    if !path.exists() {
        tracing::warn!(model_id, path = %path.display(), "model file not found on disk");
        return Err(format!(
            "Model '{}' is not downloaded. Download it first.",
            model_id
        ));
    }

    tracing::debug!(model_id, path = %path.display(), "validating model file (SHA-256)");
    let id = model_id.to_string();
    let p = path.clone();
    tokio::task::spawn_blocking(move || super::models::validate_model_file(&id, &p))
        .await
        .map_err(|e| format!("Validation task panicked: {e}"))?
        .map_err(|e| e.to_string())?;

    tracing::debug!(model_id, "model file validated OK");
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
    tracing::debug!("voice_list_models");
    Ok(state.model_manager().list_models())
}

#[tauri::command]
#[specta::specta]
pub async fn voice_list_languages() -> Result<Vec<VoiceLanguageOption>, String> {
    tracing::debug!("voice_list_languages");
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
    tracing::debug!(count = languages.len(), "voice_list_languages done");
    Ok(languages)
}

#[tauri::command]
#[specta::specta]
pub async fn voice_get_model_status(
    state: State<'_, VoiceState>,
    model_id: String,
) -> Result<ModelInfo, String> {
    tracing::debug!(model_id, "voice_get_model_status");
    let mut info = state
        .model_manager()
        .get_model_info(&model_id)
        .map_err(|error| error.to_string())?;
    if info.is_downloaded {
        let path = state
            .model_manager()
            .model_path(&model_id)
            .ok_or_else(|| format!("Unknown model: {}", model_id))?;
        info.is_loaded = state
            .runtime()
            .is_model_loaded(path)
            .await
            .map_err(|error| error.to_string())?;
    }
    tracing::debug!(
        model_id,
        is_downloaded = info.is_downloaded,
        is_loaded = info.is_loaded,
        "model status resolved"
    );
    Ok(info)
}

#[tauri::command]
#[specta::specta]
pub async fn voice_download_model(
    state: State<'_, VoiceState>,
    app: AppHandle,
    model_id: String,
) -> Result<(), String> {
    tracing::info!(model_id, "voice_download_model: starting download");
    let model_id_for_error = model_id.clone();
    let result = state
        .model_manager()
        .download_model(&model_id, |progress| {
            let _ = app.emit(VOICE_MODEL_DOWNLOAD_PROGRESS_EVENT, progress);
        })
        .await;

    match result {
        Ok(path) => {
            tracing::info!(model_id, path = %path.display(), "voice_download_model: download complete");
            let _ = app.emit(
                VOICE_MODEL_DOWNLOAD_COMPLETE_EVENT,
                ModelDownloadComplete { model_id },
            );
            Ok(())
        }
        Err(error) => {
            let message = error.to_string();
            tracing::error!(model_id = model_id_for_error, error = %message, "voice_download_model: download FAILED");
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
    tracing::info!(model_id, "voice_delete_model");
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
    tracing::info!(model_id, "voice_load_model: resolving path");
    let path = resolve_verified_model_path(&state, &model_id).await?;

    tracing::info!(model_id, path = %path.display(), "voice_load_model: loading into engine");
    let t0 = std::time::Instant::now();
    let result = state
        .runtime()
        .load_model(path)
        .await
        .map_err(|e| e.to_string());

    match &result {
        Ok(()) => tracing::info!(
            model_id,
            elapsed_ms = t0.elapsed().as_millis() as u64,
            "voice_load_model: loaded OK"
        ),
        Err(e) => {
            tracing::error!(model_id, error = %e, elapsed_ms = t0.elapsed().as_millis() as u64, "voice_load_model: load FAILED")
        }
    }
    result
}

// ── Recording commands ────────────────────────────────────────────────────

#[tauri::command]
#[specta::specta]
pub async fn voice_start_recording(
    state: State<'_, VoiceState>,
    app: AppHandle,
    session_id: String,
) -> Result<(), String> {
    tracing::info!(session_id, "voice_start_recording");
    let app_for_amp = app.clone();
    let app_for_err = app.clone();

    let result = state
        .runtime()
        .start_recording(
            session_id.clone(),
            move |payload| {
                let _ = app_for_amp.emit(VOICE_AMPLITUDE_EVENT, payload);
            },
            move |payload| {
                let _ = app_for_err.emit(VOICE_RECORDING_ERROR_EVENT, payload);
            },
        )
        .await
        .map_err(|e| e.to_string());

    match &result {
        Ok(()) => tracing::info!(session_id, "voice_start_recording: recording started"),
        Err(e) => tracing::error!(session_id, error = %e, "voice_start_recording: FAILED"),
    }
    result
}

#[tauri::command]
#[specta::specta]
pub async fn voice_stop_recording(
    state: State<'_, VoiceState>,
    app: AppHandle,
    session_id: String,
    language: Option<String>,
) -> Result<(), String> {
    tracing::info!(session_id, ?language, "voice_stop_recording");
    let t0 = std::time::Instant::now();
    let result = state
        .runtime()
        .stop_recording(session_id.clone(), language)
        .await;

    match result {
        Ok(r) => {
            tracing::info!(
                session_id,
                text_len = r.text.len(),
                trimmed_text_len = r.text.trim().len(),
                text_preview = %preview_text(&r.text),
                language = ?r.language,
                duration_ms = r.duration_ms,
                transcribe_ms = t0.elapsed().as_millis() as u64,
                "voice_stop_recording: transcription complete"
            );
            let emit_result = app.emit(
                VOICE_TRANSCRIPTION_COMPLETE_EVENT,
                TranscriptionCompletePayload {
                    session_id,
                    text: r.text,
                    language: r.language,
                    duration_ms: r.duration_ms,
                },
            );
            match emit_result {
                Ok(()) => {
                    tracing::info!("voice_stop_recording: emitted transcription_complete event")
                }
                Err(error) => {
                    tracing::error!(error = %error, "voice_stop_recording: failed to emit transcription_complete event")
                }
            }
            Ok(())
        }
        Err(e) => {
            let message = e.to_string();
            tracing::error!(
                session_id,
                error = %message,
                elapsed_ms = t0.elapsed().as_millis() as u64,
                "voice_stop_recording: transcription FAILED"
            );
            let emit_result = app.emit(
                VOICE_TRANSCRIPTION_ERROR_EVENT,
                TranscriptionErrorPayload {
                    session_id,
                    message: message.clone(),
                },
            );
            match emit_result {
                Ok(()) => tracing::info!("voice_stop_recording: emitted transcription_error event"),
                Err(error) => {
                    tracing::error!(error = %error, "voice_stop_recording: failed to emit transcription_error event")
                }
            }
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
    tracing::info!(session_id, "voice_cancel_recording");
    state
        .runtime()
        .cancel_recording(session_id)
        .await
        .map_err(|e| e.to_string())
}
