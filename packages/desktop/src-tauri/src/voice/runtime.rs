use std::path::PathBuf;
use std::sync::mpsc::{self, RecvTimeoutError, SyncSender};
use std::thread;
use std::time::{Duration, Instant};

use anyhow::Context;
use cpal::traits::{DeviceTrait, HostTrait, StreamTrait};
use ringbuf::traits::{Consumer, Producer, Split};
use ringbuf::HeapRb;
use serde::{Deserialize, Serialize};
use tokio::sync::oneshot;
use zeroize::Zeroize;

use super::engine::{resample, TranscriptionEngine, TranscriptionResult};

fn max_abs_sample(samples: &[f32]) -> f32 {
    samples
        .iter()
        .fold(0.0_f32, |max, sample| max.max(sample.abs()))
}

fn rms_level(samples: &[f32]) -> f32 {
    if samples.is_empty() {
        return 0.0;
    }

    (samples.iter().map(|sample| sample * sample).sum::<f32>() / samples.len() as f32).sqrt()
}

fn normalization_gain_for_peak(peak: f32) -> f32 {
    if peak <= 0.0 {
        return 1.0;
    }

    let target_peak = 0.85_f32;
    let unclamped_gain = target_peak / peak;
    unclamped_gain.clamp(1.0, 64.0)
}

fn live_meter_gain_for_peak(peak: f32) -> f32 {
    if peak <= 0.0 {
        return 1.0;
    }

    let target_peak = 0.35_f32;
    let unclamped_gain = target_peak / peak;
    unclamped_gain.clamp(1.0, 24.0)
}

fn normalize_audio_for_transcription(samples: &[f32]) -> Vec<f32> {
    if samples.is_empty() {
        return Vec::new();
    }

    let peak = max_abs_sample(samples);
    let gain = normalization_gain_for_peak(peak);
    if gain <= 1.0 {
        return samples.to_vec();
    }

    samples
        .iter()
        .map(|sample| (sample * gain).clamp(-1.0, 1.0))
        .collect()
}

// ── Constants ─────────────────────────────────────────────────────────────

/// Ring buffer capacity: 30 s of mono audio at 48 kHz.
const RING_BUF_FRAMES: usize = 48_000 * 30;
const WORKER_TICK: Duration = Duration::from_millis(50);
const WHISPER_SAMPLE_RATE: u32 = 16_000;
const WARN_SECS: u64 = 8 * 60;
const MAX_SECS: u64 = 10 * 60;

/// Maximum accumulated samples: 10 minutes at 48 kHz mono ~ 28.8 million samples (~115 MB).
/// This matches the `MAX_SECS` duration limit; the constant documents the implicit cap.
const _MAX_ACCUMULATED_SAMPLES: usize = 48_000 * MAX_SECS as usize;

// ── Public event payloads ─────────────────────────────────────────────────

/// Emitted ~10 times per second during recording.
/// Contains three RMS measurements covering the last 100 ms window so the
/// frontend can interpolate a smooth 30 fps waveform.
#[derive(Debug, Clone, Serialize, Deserialize, specta::Type)]
pub struct AmplitudePayload {
    pub session_id: String,
    pub values: [f32; 3],
}

/// Emitted when recording is interrupted by a device or duration error.
#[derive(Debug, Clone, Serialize, Deserialize, specta::Type)]
pub struct RecordingErrorPayload {
    pub session_id: String,
    pub message: String,
}

/// Emitted when transcription succeeds (after voice_stop_recording).
#[derive(Debug, Clone, Serialize, Deserialize, specta::Type)]
pub struct TranscriptionCompletePayload {
    pub session_id: String,
    pub text: String,
    pub language: Option<String>,
    pub duration_ms: u64,
}

/// Emitted when transcription fails (after voice_stop_recording).
#[derive(Debug, Clone, Serialize, Deserialize, specta::Type)]
pub struct TranscriptionErrorPayload {
    pub session_id: String,
    pub message: String,
}

// ── Internal worker protocol ──────────────────────────────────────────────

type ReplyTx<T> = oneshot::Sender<anyhow::Result<T>>;

/// SAFETY: WorkerMessage is Send because every constituent field is Send.
/// cpal::Stream (which is !Send on macOS) is never stored inside WorkerMessage;
/// it lives inside WorkerState exclusively on the worker thread.
enum WorkerMessage {
    LoadModel {
        path: PathBuf,
        reply: ReplyTx<()>,
    },
    IsModelLoaded {
        path: PathBuf,
        reply: ReplyTx<bool>,
    },
    StartRecording {
        session_id: String,
        reply: ReplyTx<()>,
        amp_cb: Box<dyn Fn(AmplitudePayload) + Send + 'static>,
        error_cb: Box<dyn Fn(RecordingErrorPayload) + Send + 'static>,
    },
    StopRecording {
        session_id: String,
        language: Option<String>,
        reply: ReplyTx<TranscriptionResult>,
    },
    CancelRecording {
        session_id: String,
        reply: ReplyTx<()>,
    },
    InputStreamError {
        session_id: String,
        message: String,
    },
    Shutdown,
}

// ── Worker-local state ────────────────────────────────────────────────────

/// State for an active recording session.
/// Entirely local to the worker thread; never sent across thread boundaries.
/// cpal::Stream is !Send on macOS — that is fine here because this struct
/// is created and dropped on the dedicated worker OS thread.
struct RecordingSession {
    session_id: String,
    stream: cpal::Stream,
    cons: ringbuf::HeapCons<f32>,
    accumulated: Vec<f32>,
    sample_rate: u32,
    started_at: Instant,
    amp_cb: Box<dyn Fn(AmplitudePayload) + Send + 'static>,
    error_cb: Box<dyn Fn(RecordingErrorPayload) + Send + 'static>,
}

enum WorkerState {
    Idle,
    Recording(Box<RecordingSession>),
}

// ── Public handle ─────────────────────────────────────────────────────────

/// Thin command-side handle to the dedicated voice worker thread.
///
/// The worker exclusively owns `cpal::Stream`, the ring-buffer consumer,
/// accumulated audio, and the transcription engine.  Only lightweight
/// messages and callbacks cross the thread boundary.
pub struct VoiceRuntimeHandle {
    tx: SyncSender<WorkerMessage>,
}

impl VoiceRuntimeHandle {
    /// Spawn the dedicated voice worker thread with the given transcription engine.
    pub fn spawn(engine: Box<dyn TranscriptionEngine>) -> anyhow::Result<Self> {
        let (tx, rx) = mpsc::sync_channel(8);
        let worker_tx = tx.clone();
        thread::Builder::new()
            .name("acepe-voice-worker".to_string())
            .spawn(move || worker_loop(rx, worker_tx, engine))
            .context("Failed to spawn voice worker thread")?;
        Ok(Self { tx })
    }

    /// Load a whisper model into the engine.  Must be called before the first
    /// `start_recording`; can be called again to swap models.
    pub async fn load_model(&self, path: PathBuf) -> anyhow::Result<()> {
        let (tx, rx) = oneshot::channel();
        self.tx
            .send(WorkerMessage::LoadModel { path, reply: tx })
            .map_err(|_| anyhow::anyhow!("Voice worker has stopped"))?;
        rx.await
            .map_err(|_| anyhow::anyhow!("Voice worker died before replying"))?
    }

    pub async fn is_model_loaded(&self, path: PathBuf) -> anyhow::Result<bool> {
        let (tx, rx) = oneshot::channel();
        self.tx
            .send(WorkerMessage::IsModelLoaded { path, reply: tx })
            .map_err(|_| anyhow::anyhow!("Voice worker has stopped"))?;
        rx.await
            .map_err(|_| anyhow::anyhow!("Voice worker died before replying"))?
    }

    /// Start recording from the default microphone for the given session.
    /// Errors if already recording or if no input device is available.
    pub async fn start_recording(
        &self,
        session_id: String,
        amp_cb: impl Fn(AmplitudePayload) + Send + 'static,
        error_cb: impl Fn(RecordingErrorPayload) + Send + 'static,
    ) -> anyhow::Result<()> {
        let (tx, rx) = oneshot::channel();
        self.tx
            .send(WorkerMessage::StartRecording {
                session_id,
                reply: tx,
                amp_cb: Box::new(amp_cb),
                error_cb: Box::new(error_cb),
            })
            .map_err(|_| anyhow::anyhow!("Voice worker has stopped"))?;
        rx.await
            .map_err(|_| anyhow::anyhow!("Voice worker died before replying"))?
    }

    /// Stop recording and run transcription.  Returns the result; callers
    /// are responsible for emitting the Tauri completion/error events.
    pub async fn stop_recording(
        &self,
        session_id: String,
        language: Option<String>,
    ) -> anyhow::Result<TranscriptionResult> {
        let (tx, rx) = oneshot::channel();
        self.tx
            .send(WorkerMessage::StopRecording {
                session_id,
                language,
                reply: tx,
            })
            .map_err(|_| anyhow::anyhow!("Voice worker has stopped"))?;
        rx.await
            .map_err(|_| anyhow::anyhow!("Voice worker died before replying"))?
    }

    /// Cancel an in-progress recording, discarding all captured audio.
    /// Idempotent: safe to call even when not recording.
    pub async fn cancel_recording(&self, session_id: String) -> anyhow::Result<()> {
        let (tx, rx) = oneshot::channel();
        self.tx
            .send(WorkerMessage::CancelRecording {
                session_id,
                reply: tx,
            })
            .map_err(|_| anyhow::anyhow!("Voice worker has stopped"))?;
        rx.await
            .map_err(|_| anyhow::anyhow!("Voice worker died before replying"))?
    }
}

impl Drop for VoiceRuntimeHandle {
    fn drop(&mut self) {
        let _ = self.tx.send(WorkerMessage::Shutdown);
    }
}

// ── Worker loop ───────────────────────────────────────────────────────────

fn worker_loop(
    rx: mpsc::Receiver<WorkerMessage>,
    tx: SyncSender<WorkerMessage>,
    mut engine: Box<dyn TranscriptionEngine>,
) {
    let mut state = WorkerState::Idle;
    // Track the currently loaded model path to skip redundant loads.
    let mut loaded_model_path: Option<PathBuf> = None;
    tracing::info!("voice worker loop started");

    loop {
        match rx.recv_timeout(WORKER_TICK) {
            Ok(WorkerMessage::LoadModel { path, reply }) => {
                // Skip if same model is already loaded
                if loaded_model_path.as_ref() == Some(&path) {
                    tracing::info!(path = %path.display(), "worker: LoadModel skipped (already loaded)");
                    let _ = reply.send(Ok(()));
                    continue;
                }

                tracing::info!(path = %path.display(), "worker: LoadModel");
                let t0 = Instant::now();
                let result = engine.load_model(&path);
                match &result {
                    Ok(()) => {
                        loaded_model_path = Some(path);
                        tracing::info!(
                            elapsed_ms = t0.elapsed().as_millis() as u64,
                            "worker: model loaded OK"
                        );
                    }
                    Err(e) => {
                        loaded_model_path = None;
                        tracing::error!(error = %e, elapsed_ms = t0.elapsed().as_millis() as u64, "worker: model load FAILED");
                    }
                }
                let _ = reply.send(result);
            }

            Ok(WorkerMessage::IsModelLoaded { path, reply }) => {
                let _ = reply.send(Ok(loaded_model_path.as_ref() == Some(&path)));
            }

            Ok(WorkerMessage::StartRecording {
                session_id,
                reply,
                amp_cb,
                error_cb,
            }) => {
                tracing::info!(session_id, "worker: StartRecording");
                if matches!(state, WorkerState::Recording(_)) {
                    tracing::warn!(session_id, "worker: already recording, rejecting");
                    let _ = reply.send(Err(anyhow::anyhow!("Already recording")));
                    continue;
                }
                match start_capture(session_id.clone(), amp_cb, error_cb, tx.clone()) {
                    Ok(session) => {
                        tracing::info!(
                            session_id,
                            sample_rate = session.sample_rate,
                            "worker: capture started"
                        );
                        state = WorkerState::Recording(Box::new(session));
                        let _ = reply.send(Ok(()));
                    }
                    Err(e) => {
                        tracing::error!(session_id, error = %e, "worker: capture start FAILED");
                        let _ = reply.send(Err(e));
                    }
                }
            }

            Ok(WorkerMessage::StopRecording {
                session_id,
                language,
                reply,
            }) => {
                tracing::info!(session_id, ?language, "worker: StopRecording");
                let matches_session = matches!(
                    &state,
                    WorkerState::Recording(s) if s.session_id == session_id
                );
                if !matches_session {
                    tracing::warn!(session_id, "worker: not recording for this session");
                    let _ = reply.send(Err(anyhow::anyhow!("Not currently recording")));
                    continue;
                }

                let WorkerState::Recording(mut session) =
                    std::mem::replace(&mut state, WorkerState::Idle)
                else {
                    unreachable!()
                };

                let duration_ms = session.started_at.elapsed().as_millis() as u64;
                drop(session.stream); // stop cpal capture

                // Drain remaining ring-buffer samples
                drain_into(&mut session.cons, &mut session.accumulated);
                tracing::info!(
                    session_id,
                    accumulated_samples = session.accumulated.len(),
                    accumulated_peak = max_abs_sample(&session.accumulated),
                    accumulated_rms = rms_level(&session.accumulated),
                    sample_rate = session.sample_rate,
                    duration_ms,
                    "worker: recording stopped, resampling"
                );

                // Resample to the 16 kHz Whisper requires
                let audio_16k = resample(
                    &session.accumulated,
                    session.sample_rate,
                    WHISPER_SAMPLE_RATE,
                );
                let normalized_audio_16k = normalize_audio_for_transcription(&audio_16k);
                tracing::info!(
                    session_id,
                    audio_16k_samples = audio_16k.len(),
                    audio_16k_secs = audio_16k.len() as f32 / WHISPER_SAMPLE_RATE as f32,
                    audio_16k_peak = max_abs_sample(&audio_16k),
                    audio_16k_rms = rms_level(&audio_16k),
                    suggested_gain = normalization_gain_for_peak(max_abs_sample(&audio_16k)),
                    normalized_audio_16k_peak = max_abs_sample(&normalized_audio_16k),
                    normalized_audio_16k_rms = rms_level(&normalized_audio_16k),
                    "worker: resampled, starting transcription"
                );

                // Secure-zero the full-rate buffer before dropping
                session.accumulated.zeroize();

                let t0 = Instant::now();
                let result = engine
                    .transcribe(
                        &normalized_audio_16k,
                        WHISPER_SAMPLE_RATE,
                        language.as_deref(),
                    )
                    .map(|mut r| {
                        if r.duration_ms == 0 {
                            r.duration_ms = duration_ms;
                        }
                        r
                    });
                match &result {
                    Ok(r) => tracing::info!(
                        session_id,
                        text_len = r.text.len(),
                        language = ?r.language,
                        transcribe_ms = t0.elapsed().as_millis() as u64,
                        "worker: transcription complete"
                    ),
                    Err(e) => tracing::error!(
                        session_id,
                        error = %e,
                        transcribe_ms = t0.elapsed().as_millis() as u64,
                        "worker: transcription FAILED"
                    ),
                }
                let _ = reply.send(result);
            }

            Ok(WorkerMessage::CancelRecording { session_id, reply }) => {
                let matches_session = matches!(
                    &state,
                    WorkerState::Recording(s) if s.session_id == session_id
                );
                tracing::info!(
                    session_id,
                    was_recording = matches_session,
                    "worker: CancelRecording"
                );
                if matches_session {
                    let WorkerState::Recording(mut session) =
                        std::mem::replace(&mut state, WorkerState::Idle)
                    else {
                        unreachable!()
                    };
                    drop(session.stream);
                    session.accumulated.zeroize();
                }
                // Idempotent: reply Ok whether or not we were recording
                let _ = reply.send(Ok(()));
            }

            Ok(WorkerMessage::InputStreamError {
                session_id,
                message,
            }) => {
                tracing::error!(session_id, error = %message, "worker: InputStreamError");
                let matches_session = matches!(
                    &state,
                    WorkerState::Recording(s) if s.session_id == session_id
                );
                if !matches_session {
                    continue;
                }

                let WorkerState::Recording(mut session) =
                    std::mem::replace(&mut state, WorkerState::Idle)
                else {
                    unreachable!()
                };
                drop(session.stream);
                session.accumulated.zeroize();
                (session.error_cb)(RecordingErrorPayload {
                    session_id,
                    message,
                });
            }

            Ok(WorkerMessage::Shutdown) | Err(RecvTimeoutError::Disconnected) => {
                tracing::info!("worker: shutting down");
                break;
            }

            Err(RecvTimeoutError::Timeout) => {
                // Check duration limits without taking ownership of session yet.
                let elapsed_secs = match &state {
                    WorkerState::Recording(s) => s.started_at.elapsed().as_secs(),
                    WorkerState::Idle => continue,
                };

                if elapsed_secs >= MAX_SECS {
                    // Auto-stop: exceeded hard limit — emit error and go Idle.
                    let WorkerState::Recording(mut session) =
                        std::mem::replace(&mut state, WorkerState::Idle)
                    else {
                        unreachable!()
                    };
                    let payload = RecordingErrorPayload {
                        session_id: session.session_id.clone(),
                        message: format!(
                            "Recording stopped: exceeded {} minute limit",
                            MAX_SECS / 60
                        ),
                    };
                    drop(session.stream);
                    session.accumulated.zeroize();
                    (session.error_cb)(payload);
                    continue;
                }

                if (WARN_SECS..WARN_SECS + 1).contains(&elapsed_secs) {
                    if let WorkerState::Recording(ref s) = state {
                        tracing::warn!(
                            session_id = %s.session_id,
                            "Voice recording approaching {} minute limit", WARN_SECS / 60
                        );
                    }
                }

                // Drain new samples and emit batched amplitude event.
                if let WorkerState::Recording(ref mut session) = state {
                    let mut tick_samples = Vec::new();
                    drain_into(&mut session.cons, &mut tick_samples);
                    session.accumulated.extend_from_slice(&tick_samples);

                    if !tick_samples.is_empty() {
                        let values = compute_amplitude_batch(&tick_samples);
                        (session.amp_cb)(AmplitudePayload {
                            session_id: session.session_id.clone(),
                            values,
                        });
                    }
                }
            }
        }
    }
}

// ── Audio capture ─────────────────────────────────────────────────────────

fn start_capture(
    session_id: String,
    amp_cb: Box<dyn Fn(AmplitudePayload) + Send + 'static>,
    error_cb: Box<dyn Fn(RecordingErrorPayload) + Send + 'static>,
    tx: SyncSender<WorkerMessage>,
) -> anyhow::Result<RecordingSession> {
    tracing::info!(session_id, "start_capture: getting default input device");
    let host = cpal::default_host();
    let device = host
        .default_input_device()
        .ok_or_else(|| anyhow::anyhow!(
            "No audio input device available. On macOS, check System Settings \u{2192} Privacy & Security \u{2192} Microphone."
        ))?;

    let device_name = device
        .name()
        .unwrap_or_else(|error| format!("<unknown device name: {error}>"));
    tracing::info!(session_id, device_name = %device_name, "start_capture: selected input device");

    let supported = device.default_input_config()
        .map_err(|e| anyhow::anyhow!(
            "Failed to get microphone configuration: {}. On macOS, ensure Acepe has microphone permission in System Settings \u{2192} Privacy & Security \u{2192} Microphone.", e
        ))?;
    let sample_rate = supported.sample_rate().0;
    let channels = supported.channels() as usize;
    let format = supported.sample_format();
    tracing::info!(
        session_id,
        sample_rate,
        channels,
        ?format,
        "start_capture: input device config"
    );
    let config: cpal::StreamConfig = supported.into();

    let rb = HeapRb::<f32>::new(RING_BUF_FRAMES);
    let (prod, cons) = rb.split();
    let stream = build_input_stream(
        &device,
        &config,
        format,
        channels,
        prod,
        tx,
        session_id.clone(),
    )?;
    stream.play()?;

    Ok(RecordingSession {
        session_id,
        stream,
        cons,
        accumulated: Vec::new(),
        sample_rate,
        started_at: Instant::now(),
        amp_cb,
        error_cb,
    })
}

fn build_input_stream(
    device: &cpal::Device,
    config: &cpal::StreamConfig,
    format: cpal::SampleFormat,
    channels: usize,
    prod: ringbuf::HeapProd<f32>,
    tx: SyncSender<WorkerMessage>,
    session_id: String,
) -> anyhow::Result<cpal::Stream> {
    // Each branch below moves `prod` into exactly one closure.  The match arms
    // are mutually exclusive, so the value is moved at most once at runtime.
    let mut prod_opt = Some(prod);

    let stream = match format {
        cpal::SampleFormat::F32 => {
            let mut p = prod_opt.take().unwrap();
            let error_tx = tx.clone();
            let error_session_id = session_id.clone();
            device.build_input_stream(
                config,
                move |data: &[f32], _: &cpal::InputCallbackInfo| {
                    push_mono(&mut p, data, channels);
                },
                move |err| {
                    tracing::error!(error = %err, "cpal F32 stream error");
                    let _ = error_tx.try_send(WorkerMessage::InputStreamError {
                        session_id: error_session_id.clone(),
                        message: format!("Microphone input failed: {}", err),
                    });
                },
                None,
            )?
        }
        cpal::SampleFormat::I16 => {
            let mut p = prod_opt.take().unwrap();
            let error_tx = tx.clone();
            let error_session_id = session_id.clone();
            device.build_input_stream(
                config,
                move |data: &[i16], _: &cpal::InputCallbackInfo| {
                    let f: Vec<f32> = data.iter().map(|s| *s as f32 / 32_767.0).collect();
                    push_mono(&mut p, &f, channels);
                },
                move |err| {
                    tracing::error!(error = %err, "cpal I16 stream error");
                    let _ = error_tx.try_send(WorkerMessage::InputStreamError {
                        session_id: error_session_id.clone(),
                        message: format!("Microphone input failed: {}", err),
                    });
                },
                None,
            )?
        }
        cpal::SampleFormat::U16 => {
            let mut p = prod_opt.take().unwrap();
            let error_tx = tx;
            let error_session_id = session_id;
            device.build_input_stream(
                config,
                move |data: &[u16], _: &cpal::InputCallbackInfo| {
                    let f: Vec<f32> = data
                        .iter()
                        .map(|s| (*s as f32 - 32_768.0) / 32_767.0)
                        .collect();
                    push_mono(&mut p, &f, channels);
                },
                move |err| {
                    tracing::error!(error = %err, "cpal U16 stream error");
                    let _ = error_tx.try_send(WorkerMessage::InputStreamError {
                        session_id: error_session_id.clone(),
                        message: format!("Microphone input failed: {}", err),
                    });
                },
                None,
            )?
        }
        other => anyhow::bail!("Unsupported cpal sample format: {:?}", other),
    };
    Ok(stream)
}

/// Push a possibly-interleaved buffer as mono f32 into the ring buffer,
/// taking only the first channel when the device is multi-channel.
fn push_mono(prod: &mut ringbuf::HeapProd<f32>, data: &[f32], channels: usize) {
    if channels <= 1 {
        prod.push_slice(data);
    } else {
        let mono: Vec<f32> = data.chunks(channels).map(|frame| frame[0]).collect();
        prod.push_slice(&mono);
    }
}

// ── Helpers ───────────────────────────────────────────────────────────────

fn drain_into(cons: &mut ringbuf::HeapCons<f32>, target: &mut Vec<f32>) {
    let mut tmp = [0.0f32; 4_096];
    loop {
        let n = cons.pop_slice(&mut tmp);
        if n == 0 {
            break;
        }
        target.extend_from_slice(&tmp[..n]);
    }
}

/// Divide `samples` into three equal windows and return the RMS of each.
/// Returns `[0.0; 3]` for empty input.
fn compute_amplitude_batch(samples: &[f32]) -> [f32; 3] {
    if samples.is_empty() {
        return [0.0; 3];
    }

    let gain = live_meter_gain_for_peak(max_abs_sample(samples));
    let chunk = (samples.len() / 3).max(1);
    let rms = |s: &[f32]| -> f32 {
        if s.is_empty() {
            return 0.0;
        }

        let level = (s.iter().map(|x| x * x).sum::<f32>() / s.len() as f32).sqrt() * gain;
        level.clamp(0.0, 1.0)
    };
    [
        rms(&samples[..chunk]),
        rms(&samples[chunk..(2 * chunk).min(samples.len())]),
        rms(&samples[(2 * chunk).min(samples.len())..]),
    ]
}

#[cfg(test)]
mod tests {
    use super::*;

    use std::path::Path;
    use std::sync::{Arc, Mutex};

    struct CountingEngine {
        loads: Arc<Mutex<Vec<PathBuf>>>,
    }

    impl super::super::engine::TranscriptionEngine for CountingEngine {
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

        fn load_model(&mut self, path: &Path) -> anyhow::Result<()> {
            self.loads
                .lock()
                .expect("load mutex poisoned")
                .push(path.to_path_buf());
            Ok(())
        }
    }

    #[tokio::test]
    async fn skips_reloading_the_same_model_path() {
        let loads = Arc::new(Mutex::new(Vec::new()));
        let runtime = VoiceRuntimeHandle::spawn(Box::new(CountingEngine {
            loads: Arc::clone(&loads),
        }))
        .expect("spawn runtime");
        let model_path = PathBuf::from("/tmp/small.en.bin");

        runtime
            .load_model(model_path.clone())
            .await
            .expect("first load succeeds");
        runtime
            .load_model(model_path.clone())
            .await
            .expect("second load succeeds");

        assert_eq!(
            loads.lock().expect("load mutex poisoned").as_slice(),
            &[model_path]
        );
    }

    #[tokio::test]
    async fn reloads_when_model_path_changes() {
        let loads = Arc::new(Mutex::new(Vec::new()));
        let runtime = VoiceRuntimeHandle::spawn(Box::new(CountingEngine {
            loads: Arc::clone(&loads),
        }))
        .expect("spawn runtime");
        let first_model_path = PathBuf::from("/tmp/small.en.bin");
        let second_model_path = PathBuf::from("/tmp/base.en.bin");

        runtime
            .load_model(first_model_path.clone())
            .await
            .expect("first load succeeds");
        runtime
            .load_model(second_model_path.clone())
            .await
            .expect("second model load succeeds");

        assert_eq!(
            loads.lock().expect("load mutex poisoned").as_slice(),
            &[first_model_path, second_model_path]
        );
    }

    #[test]
    fn compute_amplitude_batch_boosts_quiet_capture_for_live_meter() {
        let samples = vec![0.004_f32; 96];

        let values = compute_amplitude_batch(&samples);

        assert!(values.iter().all(|value| *value > 0.02));
        assert!(values.iter().all(|value| *value <= 1.0));
    }

    #[test]
    fn compute_amplitude_batch_keeps_silence_silent() {
        let values = compute_amplitude_batch(&[0.0; 96]);

        assert_eq!(values, [0.0, 0.0, 0.0]);
    }

    #[test]
    fn normalizes_quiet_audio_up_to_target_peak() {
        let audio = vec![0.05_f32, -0.025_f32, 0.0_f32, 0.025_f32];

        let normalized = normalize_audio_for_transcription(&audio);

        assert!(max_abs_sample(&normalized) > 0.8);
        assert!(max_abs_sample(&normalized) <= 0.85);
    }

    #[test]
    fn normalizes_very_quiet_audio_up_to_target_peak() {
        let audio = vec![0.0138_f32, -0.0069_f32, 0.0_f32, 0.0069_f32];

        let normalized = normalize_audio_for_transcription(&audio);

        assert!(max_abs_sample(&normalized) > 0.8);
        assert!(max_abs_sample(&normalized) <= 0.85);
    }

    #[test]
    fn leaves_loud_audio_unchanged() {
        let audio = vec![0.9_f32, -0.4_f32, 0.1_f32];

        let normalized = normalize_audio_for_transcription(&audio);

        assert_eq!(normalized, audio);
    }

    #[test]
    fn stub_engine_returns_empty_transcription() {
        let engine = super::super::engine::StubEngine;
        let result = engine
            .transcribe(&[0.1, -0.1, 0.2], 16_000, None)
            .expect("stub transcription should succeed");
        assert_eq!(result.text, "");
        assert!(result.language.is_none());
    }

    #[test]
    fn resample_noop_when_rates_match() {
        let input = vec![1.0_f32, 2.0, 3.0];
        let output = resample(&input, 16_000, 16_000);
        assert_eq!(output, input);
    }

    #[test]
    fn resample_empty_input_returns_empty() {
        let output = resample(&[], 48_000, 16_000);
        assert!(output.is_empty());
    }

    #[test]
    fn resample_down_sample_ratio_is_approximately_correct() {
        let input: Vec<f32> = (0..48_000)
            .map(|index| (index as f32 * 0.001).sin())
            .collect();
        let output = resample(&input, 48_000, 16_000);
        let difference = (output.len() as i64 - 16_000_i64).abs();
        assert!(
            difference <= 2,
            "Expected ~16000 samples, got {}",
            output.len()
        );
    }

    #[tokio::test]
    async fn runtime_can_be_spawned_and_dropped() {
        let handle = VoiceRuntimeHandle::spawn(Box::new(super::super::engine::StubEngine))
            .expect("spawn runtime");
        drop(handle);
    }

    #[tokio::test]
    async fn stop_when_not_recording_returns_error() {
        let handle = VoiceRuntimeHandle::spawn(Box::new(super::super::engine::StubEngine))
            .expect("spawn runtime");
        let result = handle.stop_recording("session-99".to_string(), None).await;
        assert!(result.is_err(), "stop when idle should return Err");
    }

    #[tokio::test]
    async fn cancel_when_not_recording_is_idempotent() {
        let handle = VoiceRuntimeHandle::spawn(Box::new(super::super::engine::StubEngine))
            .expect("spawn runtime");
        let result = handle.cancel_recording("session-99".to_string()).await;
        assert!(result.is_ok(), "cancel when idle should return Ok");
    }

    #[tokio::test]
    async fn multiple_cancel_calls_are_idempotent() {
        let handle = VoiceRuntimeHandle::spawn(Box::new(super::super::engine::StubEngine))
            .expect("spawn runtime");
        for _ in 0..3 {
            let result = handle.cancel_recording("session-99".to_string()).await;
            assert!(result.is_ok());
        }
    }
}
