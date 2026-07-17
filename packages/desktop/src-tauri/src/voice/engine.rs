use std::io::Write;
use std::path::{Path, PathBuf};
use std::process::Command;

use anyhow::Context;
use serde::{Deserialize, Serialize};
use tempfile::NamedTempFile;

/// Result returned by a transcription backend.
#[derive(Debug, Clone, Serialize, Deserialize, specta::Type)]
pub struct TranscriptionResult {
    pub text: String,
    pub language: Option<String>,
    pub duration_ms: u64,
}

/// Abstraction over a transcription backend.
///
/// Thread-confined: the dedicated voice worker calls this on its own OS thread.
/// `load_model` / `unload_model` are called from the worker loop before inference.
pub trait TranscriptionEngine: Send {
    fn transcribe(
        &self,
        audio: &[f32],
        sample_rate: u32,
        language: Option<&str>,
    ) -> anyhow::Result<TranscriptionResult>;

    /// Load a model file from disk.  Default implementation is a no-op so that
    /// `StubEngine` does not need to override it.
    fn load_model(&mut self, _path: &Path) -> anyhow::Result<()> {
        Ok(())
    }

    /// Release the loaded model to free memory.
    fn unload_model(&mut self) {}
}

// ── Stub engine (used in tests) ─────────────────────────────────────────────────

/// Stub — returns empty text immediately, for unit tests and CI.
pub struct StubEngine;

impl TranscriptionEngine for StubEngine {
    fn transcribe(
        &self,
        _audio: &[f32],
        _sample_rate: u32,
        _language: Option<&str>,
    ) -> anyhow::Result<TranscriptionResult> {
        Ok(TranscriptionResult {
            text: String::new(),
            language: None,
            duration_ms: 0,
        })
    }
}

// ── External command engine ──────────────────────────────────────────────────

const EXTERNAL_STT_COMMAND_ENV: &str = "ACEPE_VOICE_STT_COMMAND";
const EXTERNAL_STT_MODEL_PATH_ENV: &str = "ACEPE_VOICE_STT_MODEL_PATH";
const EXTERNAL_STT_LANGUAGE_ENV: &str = "ACEPE_VOICE_LANGUAGE";
const EXTERNAL_STT_AUDIO_PATH_ENV: &str = "ACEPE_VOICE_AUDIO_PATH";

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ExternalCommandConfig {
    pub command: PathBuf,
    pub model_path: Option<PathBuf>,
}

impl ExternalCommandConfig {
    pub fn from_env() -> anyhow::Result<Self> {
        let command = std::env::var(EXTERNAL_STT_COMMAND_ENV)
            .with_context(|| format!("{EXTERNAL_STT_COMMAND_ENV} is not configured"))?;
        let command_path = PathBuf::from(command);
        if !command_path.exists() {
            anyhow::bail!(
                "{} does not exist: {}",
                EXTERNAL_STT_COMMAND_ENV,
                command_path.display()
            );
        }

        let model_path = std::env::var(EXTERNAL_STT_MODEL_PATH_ENV)
            .ok()
            .filter(|value| !value.trim().is_empty())
            .map(PathBuf::from);

        Ok(Self {
            command: command_path,
            model_path,
        })
    }
}

#[derive(Debug, Deserialize)]
struct ExternalCommandJsonOutput {
    text: String,
    language: Option<String>,
}

pub struct ExternalCommandEngine {
    config: Option<ExternalCommandConfig>,
}

impl ExternalCommandEngine {
    pub fn from_env() -> Self {
        Self { config: None }
    }

    #[cfg(test)]
    fn from_config(config: ExternalCommandConfig) -> Self {
        Self {
            config: Some(config),
        }
    }
}

fn write_wav_i16_mono(path: &Path, audio: &[f32], sample_rate: u32) -> anyhow::Result<()> {
    let data_len = audio.len() as u32 * 2;
    let file_len = 36_u32 + data_len;
    let mut file = std::fs::File::create(path)
        .with_context(|| format!("Failed to create temporary WAV {}", path.display()))?;

    file.write_all(b"RIFF")?;
    file.write_all(&file_len.to_le_bytes())?;
    file.write_all(b"WAVE")?;
    file.write_all(b"fmt ")?;
    file.write_all(&16_u32.to_le_bytes())?;
    file.write_all(&1_u16.to_le_bytes())?;
    file.write_all(&1_u16.to_le_bytes())?;
    file.write_all(&sample_rate.to_le_bytes())?;
    file.write_all(&(sample_rate * 2).to_le_bytes())?;
    file.write_all(&2_u16.to_le_bytes())?;
    file.write_all(&16_u16.to_le_bytes())?;
    file.write_all(b"data")?;
    file.write_all(&data_len.to_le_bytes())?;

    for sample in audio {
        let scaled = (sample.clamp(-1.0, 1.0) * i16::MAX as f32) as i16;
        file.write_all(&scaled.to_le_bytes())?;
    }

    file.flush()?;
    Ok(())
}

fn parse_external_command_stdout(stdout: &[u8]) -> anyhow::Result<TranscriptionResult> {
    let trimmed = String::from_utf8_lossy(stdout).trim().to_string();
    if trimmed.is_empty() {
        return Ok(TranscriptionResult {
            text: String::new(),
            language: None,
            duration_ms: 0,
        });
    }

    if let Ok(parsed) = serde_json::from_str::<ExternalCommandJsonOutput>(&trimmed) {
        return Ok(TranscriptionResult {
            text: parsed.text.trim().to_string(),
            language: parsed.language,
            duration_ms: 0,
        });
    }

    Ok(TranscriptionResult {
        text: trimmed,
        language: None,
        duration_ms: 0,
    })
}

impl TranscriptionEngine for ExternalCommandEngine {
    fn load_model(&mut self, _path: &Path) -> anyhow::Result<()> {
        self.config = Some(ExternalCommandConfig::from_env()?);
        Ok(())
    }

    fn unload_model(&mut self) {
        self.config = None;
    }

    fn transcribe(
        &self,
        audio: &[f32],
        sample_rate: u32,
        language: Option<&str>,
    ) -> anyhow::Result<TranscriptionResult> {
        let config = self
            .config
            .as_ref()
            .context("External STT backend is not loaded")?;
        let audio_file = NamedTempFile::new().context("Failed to create temporary audio file")?;
        write_wav_i16_mono(audio_file.path(), audio, sample_rate)?;

        let mut command = Command::new(&config.command);
        command.env(EXTERNAL_STT_AUDIO_PATH_ENV, audio_file.path());
        if let Some(model_path) = &config.model_path {
            command.env(EXTERNAL_STT_MODEL_PATH_ENV, model_path);
        }
        if let Some(language) = language {
            command.env(EXTERNAL_STT_LANGUAGE_ENV, language);
        }

        let output = command.output().with_context(|| {
            format!(
                "Failed to run external STT command {}",
                config.command.display()
            )
        })?;
        if !output.status.success() {
            let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
            anyhow::bail!(
                "External STT command failed with status {}{}",
                output.status,
                if stderr.is_empty() {
                    String::new()
                } else {
                    format!(": {stderr}")
                }
            );
        }

        parse_external_command_stdout(&output.stdout)
    }
}

// ── Whisper engine ───────────────────────────────────────────────────────────

#[cfg(feature = "whisper-native")]
mod whisper_engine {
    use super::{TranscriptionEngine, TranscriptionResult};
    use anyhow::Context;
    use std::path::{Path, PathBuf};

    use whisper_rs::{FullParams, SamplingStrategy, WhisperContext, WhisperContextParameters};

    fn preview_text(text: &str) -> String {
        let normalized = text.split_whitespace().collect::<Vec<_>>().join(" ");
        if normalized.len() <= 120 {
            return normalized;
        }
        format!("{}...", &normalized[..120])
    }

    /// Real transcription engine backed by whisper.cpp via whisper-rs.
    ///
    /// Thread-confined: `WhisperContext` lives on the dedicated voice worker thread
    /// and is never moved across a `spawn_blocking` boundary.
    ///
    /// Metal GPU acceleration is compiled in when the package enables the
    /// `whisper-metal` feature; at runtime whisper-rs auto-detects whether Metal
    /// is available and falls back to CPU automatically.
    pub struct WhisperEngine {
        context: Option<WhisperContext>,
        model_path: Option<PathBuf>,
    }

    #[derive(Debug, Clone, PartialEq, Eq)]
    struct ResolvedLanguage<'a> {
        language: Option<&'a str>,
        detect_language: bool,
    }

    fn is_english_only_model_path(path: Option<&Path>) -> bool {
        path.and_then(|model_path| model_path.file_name())
            .and_then(|file_name| file_name.to_str())
            .is_some_and(|file_name| file_name.contains(".en."))
    }

    fn should_retry_empty_multilingual_transcription(
        model_path: Option<&Path>,
        requested_language: Option<&str>,
        detected_language: Option<&str>,
        text: &str,
    ) -> bool {
        if is_english_only_model_path(model_path) {
            return false;
        }

        if requested_language.is_some() {
            return false;
        }

        if text.trim().is_empty() {
            return detected_language.is_some();
        }

        false
    }

    fn transcribe_with_params(
        ctx: &WhisperContext,
        model_path: Option<&Path>,
        audio: &[f32],
        requested_language: Option<&str>,
    ) -> anyhow::Result<TranscriptionResult> {
        let mut state = ctx
            .create_state()
            .context("Failed to create whisper state")?;

        let resolved_language = resolve_whisper_language(model_path, requested_language);
        tracing::info!(
            requested_language = ?requested_language,
            resolved_language = ?resolved_language.language,
            detect_language = resolved_language.detect_language,
            english_only_model = is_english_only_model_path(model_path),
            "WhisperEngine: resolved language params"
        );

        let mut params = FullParams::new(SamplingStrategy::Greedy { best_of: 1 });
        params.set_print_special(false);
        params.set_print_progress(false);
        params.set_print_realtime(false);
        params.set_print_timestamps(false);
        params.set_translate(false);
        params.set_suppress_blank(false);
        params.set_suppress_nst(true);
        params.set_language(resolved_language.language);
        params.set_detect_language(resolved_language.detect_language);

        let t0 = std::time::Instant::now();
        state
            .full(params, audio)
            .context("Whisper transcription failed")?;
        let ffi_elapsed = t0.elapsed();

        let mut text = String::new();
        let mut segment_count = 0_usize;
        for segment in state.as_iter() {
            let seg = segment.to_str_lossy().ok().unwrap_or_default();
            let seg = seg.trim();
            if !seg.is_empty() {
                if !text.is_empty() {
                    text.push(' ');
                }
                text.push_str(seg);
                segment_count += 1;
            }
        }

        let language = whisper_rs::get_lang_str(state.full_lang_id_from_state()).map(String::from);
        tracing::info!(
            text_len = text.len(),
            trimmed_text_len = text.trim().len(),
            text_preview = %preview_text(&text),
            segments = segment_count,
            detected_language = ?language,
            ffi_ms = ffi_elapsed.as_millis() as u64,
            "WhisperEngine: transcription done"
        );

        Ok(TranscriptionResult {
            text: text.trim().to_string(),
            language,
            duration_ms: 0,
        })
    }

    fn resolve_whisper_language<'a>(
        model_path: Option<&Path>,
        requested_language: Option<&'a str>,
    ) -> ResolvedLanguage<'a> {
        if is_english_only_model_path(model_path) {
            return ResolvedLanguage {
                language: Some("en"),
                detect_language: false,
            };
        }

        if let Some(language) = requested_language {
            return ResolvedLanguage {
                language: Some(language),
                detect_language: false,
            };
        }

        ResolvedLanguage {
            language: None,
            detect_language: true,
        }
    }

    impl WhisperEngine {
        /// Create an unloaded engine.  Call `load_model` before recording.
        pub fn new() -> Self {
            Self {
                context: None,
                model_path: None,
            }
        }
    }

    impl Default for WhisperEngine {
        fn default() -> Self {
            Self::new()
        }
    }

    impl TranscriptionEngine for WhisperEngine {
        fn load_model(&mut self, path: &Path) -> anyhow::Result<()> {
            tracing::info!(path = %path.display(), "WhisperEngine: loading model");
            let t0 = std::time::Instant::now();
            // WhisperContextParameters::default() is sufficient — Metal GPU is enabled
            // at compile-time via the `whisper-rs/metal` feature flag.
            let ctx = WhisperContext::new_with_params(
                path.to_str().context("Model path is not valid UTF-8")?,
                WhisperContextParameters::default(),
            )
            .context("Failed to load whisper model")?;

            self.context = Some(ctx);
            self.model_path = Some(path.to_path_buf());
            tracing::info!(
                elapsed_ms = t0.elapsed().as_millis() as u64,
                "WhisperEngine: model loaded"
            );
            Ok(())
        }

        fn unload_model(&mut self) {
            tracing::info!("WhisperEngine: unloading model");
            self.context = None;
            self.model_path = None;
        }

        /// Transcribe audio using the loaded whisper model.
        ///
        /// NOTE: `state.full()` is a blocking FFI call that can take 30-60+ seconds
        /// for large audio buffers with the medium model. The worker thread cannot
        /// process `CancelRecording` or `Shutdown` messages during transcription.
        /// A future improvement could chunk the audio and check for cancellation
        /// between chunks, but whisper.cpp does not currently support incremental
        /// transcription within a single `full()` call.
        fn transcribe(
            &self,
            audio: &[f32],
            _sample_rate: u32,
            language: Option<&str>,
        ) -> anyhow::Result<TranscriptionResult> {
            tracing::info!(
                audio_samples = audio.len(),
                ?language,
                "WhisperEngine: starting transcription"
            );
            let ctx = self
                .context
                .as_ref()
                .context("No model loaded — call voice_load_model first")?;
            let first_result =
                transcribe_with_params(ctx, self.model_path.as_deref(), audio, language)?;
            if should_retry_empty_multilingual_transcription(
                self.model_path.as_deref(),
                language,
                first_result.language.as_deref(),
                &first_result.text,
            ) {
                tracing::info!(
                    detected_language = ?first_result.language,
                    "WhisperEngine: retrying empty multilingual transcription with explicit language"
                );

                let retry_result = transcribe_with_params(
                    ctx,
                    self.model_path.as_deref(),
                    audio,
                    first_result.language.as_deref(),
                )?;
                return Ok(retry_result);
            }

            Ok(first_result)
        }
    }
}

#[cfg(feature = "whisper-native")]
pub use whisper_engine::WhisperEngine;

// ── Resampler ───────────────────────────────────────────────────────────────

/// Resample a mono f32 PCM buffer from `input_rate` to `target_rate` using
/// linear interpolation.  Whisper expects exactly 16 kHz; most devices output
/// 44.1 kHz or 48 kHz.
pub fn resample(input: &[f32], input_rate: u32, target_rate: u32) -> Vec<f32> {
    if input_rate == target_rate || input.is_empty() {
        return input.to_vec();
    }
    let ratio = input_rate as f64 / target_rate as f64;
    let output_len = ((input.len() as f64) / ratio).ceil() as usize;
    let mut output = Vec::with_capacity(output_len);
    for i in 0..output_len {
        let src = i as f64 * ratio;
        let floor = src as usize;
        let frac = (src - floor as f64) as f32;
        let a = input.get(floor).copied().unwrap_or(0.0);
        let b = input.get(floor + 1).copied().unwrap_or(a);
        output.push(a + frac * (b - a));
    }
    output
}

#[cfg(test)]
mod tests {
    use super::*;

    #[cfg(unix)]
    #[test]
    fn external_command_engine_transcribes_with_audio_path_env() {
        use std::os::unix::fs::PermissionsExt;

        let dir = tempfile::tempdir().expect("tempdir");
        let script_path = dir.path().join("stt.sh");
        std::fs::write(
            &script_path,
            r#"#!/bin/sh
test -f "$ACEPE_VOICE_AUDIO_PATH" || exit 17
printf '{"text":"hello from external","language":"en"}'
"#,
        )
        .expect("write script");
        let mut permissions = std::fs::metadata(&script_path)
            .expect("script metadata")
            .permissions();
        permissions.set_mode(0o755);
        std::fs::set_permissions(&script_path, permissions).expect("chmod script");

        let engine = ExternalCommandEngine::from_config(ExternalCommandConfig {
            command: script_path,
            model_path: None,
        });

        let result = engine
            .transcribe(&[0.0, 0.25, -0.25], 16_000, Some("en"))
            .expect("external command should transcribe");

        assert_eq!(result.text, "hello from external");
        assert_eq!(result.language.as_deref(), Some("en"));
    }

    #[test]
    fn external_command_stdout_can_be_plain_text() {
        let result = parse_external_command_stdout(b" hello plain text \n")
            .expect("plain text stdout should parse");

        assert_eq!(result.text, "hello plain text");
        assert_eq!(result.language, None);
    }
}

#[cfg(all(test, feature = "whisper-native"))]
mod whisper_tests {
    use super::whisper_engine::{
        is_english_only_model_path, resolve_whisper_language,
        should_retry_empty_multilingual_transcription, ResolvedLanguage,
    };
    use std::path::Path;

    #[test]
    fn english_only_model_forces_english_when_language_is_auto() {
        let resolved = resolve_whisper_language(Path::new("/tmp/ggml-small.en.bin").into(), None);

        assert_eq!(
            resolved,
            ResolvedLanguage {
                language: Some("en"),
                detect_language: false,
            }
        );
    }

    #[test]
    fn multilingual_model_keeps_auto_detect_when_language_is_auto() {
        let resolved = resolve_whisper_language(Path::new("/tmp/ggml-small.bin").into(), None);

        assert_eq!(
            resolved,
            ResolvedLanguage {
                language: None,
                detect_language: true,
            }
        );
    }

    #[test]
    fn english_only_model_ignores_explicit_non_english_language() {
        let resolved =
            resolve_whisper_language(Path::new("/tmp/ggml-small.en.bin").into(), Some("es"));

        assert_eq!(
            resolved,
            ResolvedLanguage {
                language: Some("en"),
                detect_language: false,
            }
        );
    }

    #[test]
    fn explicit_language_disables_detect_for_multilingual_model() {
        let resolved =
            resolve_whisper_language(Path::new("/tmp/ggml-small.bin").into(), Some("es"));

        assert_eq!(
            resolved,
            ResolvedLanguage {
                language: Some("es"),
                detect_language: false,
            }
        );
    }

    #[test]
    fn english_only_detection_uses_model_filename() {
        assert!(is_english_only_model_path(Some(Path::new(
            "/tmp/ggml-small.en.bin"
        ))));
        assert!(!is_english_only_model_path(Some(Path::new(
            "/tmp/ggml-small.bin"
        ))));
    }

    #[test]
    fn retries_empty_multilingual_transcription_when_language_was_detected() {
        assert!(should_retry_empty_multilingual_transcription(
            Path::new("/tmp/ggml-small.bin").into(),
            None,
            Some("fr"),
            "",
        ));
    }

    #[test]
    fn does_not_retry_when_text_is_present() {
        assert!(!should_retry_empty_multilingual_transcription(
            Path::new("/tmp/ggml-small.bin").into(),
            None,
            Some("fr"),
            "bonjour",
        ));
    }

    #[test]
    fn does_not_retry_for_english_only_models() {
        assert!(!should_retry_empty_multilingual_transcription(
            Path::new("/tmp/ggml-small.en.bin").into(),
            None,
            Some("en"),
            "",
        ));
    }

    #[test]
    fn does_not_retry_when_language_was_explicit() {
        assert!(!should_retry_empty_multilingual_transcription(
            Path::new("/tmp/ggml-small.bin").into(),
            Some("fr"),
            Some("fr"),
            "",
        ));
    }
}
