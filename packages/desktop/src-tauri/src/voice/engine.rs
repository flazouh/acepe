use std::path::{Path, PathBuf};

use anyhow::Context;
use serde::{Deserialize, Serialize};

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

// ── Whisper engine ───────────────────────────────────────────────────────────

use whisper_rs::{FullParams, SamplingStrategy, WhisperContext, WhisperContextParameters};

/// Real transcription engine backed by whisper.cpp via whisper-rs.
///
/// Thread-confined: `WhisperContext` lives on the dedicated voice worker thread
/// and is never moved across a `spawn_blocking` boundary.
///
/// Metal GPU acceleration is compiled in via the `whisper-rs/metal` feature;
/// at runtime whisper-rs auto-detects whether Metal is available and falls
/// back to CPU automatically.
pub struct WhisperEngine {
    context: Option<WhisperContext>,
    model_path: Option<PathBuf>,
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
        // WhisperContextParameters::default() is sufficient — Metal GPU is enabled
        // at compile-time via the `whisper-rs/metal` feature flag.
        let ctx = WhisperContext::new_with_params(
            path.to_str()
                .context("Model path is not valid UTF-8")?,
            WhisperContextParameters::default(),
        )
        .context("Failed to load whisper model")?;

        self.context = Some(ctx);
        self.model_path = Some(path.to_path_buf());
        Ok(())
    }

    fn unload_model(&mut self) {
        self.context = None;
        self.model_path = None;
    }

    fn transcribe(
        &self,
        audio: &[f32],
        _sample_rate: u32,
        language: Option<&str>,
    ) -> anyhow::Result<TranscriptionResult> {
        let ctx = self
            .context
            .as_ref()
            .context("No model loaded — call voice_load_model first")?;

        let mut state = ctx
            .create_state()
            .context("Failed to create whisper state")?;

        let mut params = FullParams::new(SamplingStrategy::Greedy { best_of: 1 });
        params.set_print_special(false);
        params.set_print_progress(false);
        params.set_print_realtime(false);
        params.set_print_timestamps(false);
        params.set_suppress_blank(true);
        params.set_suppress_nst(true);
        params.set_language(language);
        params.set_detect_language(language.is_none());

        state
            .full(params, audio)
            .context("Whisper transcription failed")?;

        let mut text = String::new();
        for segment in state.as_iter() {
            let seg = segment.to_str_lossy().ok().unwrap_or_default();
            let seg = seg.trim();
            if !seg.is_empty() {
                if !text.is_empty() {
                    text.push(' ');
                }
                text.push_str(seg);
            }
        }

        let language = whisper_rs::get_lang_str(state.full_lang_id_from_state())
            .map(String::from);

        Ok(TranscriptionResult {
            text,
            language,
            duration_ms: 0, // Caller sets the wall-clock recording duration
        })
    }
}

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
