use acepe_lib::voice::engine::{resample, StubEngine, TranscriptionEngine};
use acepe_lib::voice::runtime::VoiceRuntimeHandle;

// ── Engine unit tests (no hardware required) ──────────────────────────────

#[test]
fn stub_engine_returns_empty_transcription() {
    let engine = StubEngine;
    let result = engine
        .transcribe(&[0.1, -0.1, 0.2], 16_000, None)
        .unwrap();
    assert_eq!(result.text, "");
    assert!(result.language.is_none());
}

#[test]
fn resample_noop_when_rates_match() {
    let input = vec![1.0f32, 2.0, 3.0];
    let out = resample(&input, 16_000, 16_000);
    assert_eq!(out, input);
}

#[test]
fn resample_empty_input_returns_empty() {
    let out = resample(&[], 48_000, 16_000);
    assert!(out.is_empty());
}

#[test]
fn resample_down_sample_ratio_is_approximately_correct() {
    let input: Vec<f32> = (0..48_000).map(|i| (i as f32 * 0.001).sin()).collect();
    let out = resample(&input, 48_000, 16_000);
    // Expected output length: 16_000 ± a small rounding tolerance
    let diff = (out.len() as i64 - 16_000i64).abs();
    assert!(diff <= 2, "Expected ~16000 samples, got {}", out.len());
}

// ── Runtime lifecycle tests (no audio hardware required) ──────────────────

#[tokio::test]
async fn runtime_can_be_spawned_and_dropped() {
    let handle = VoiceRuntimeHandle::spawn(Box::new(StubEngine));
    drop(handle);
    // Worker thread received Shutdown and exited cleanly.
}

#[tokio::test]
async fn stop_when_not_recording_returns_error() {
    let handle = VoiceRuntimeHandle::spawn(Box::new(StubEngine));
    let result = handle.stop_recording("session-99".to_string(), None).await;
    assert!(result.is_err(), "stop when idle should return Err");
}

#[tokio::test]
async fn cancel_when_not_recording_is_idempotent() {
    let handle = VoiceRuntimeHandle::spawn(Box::new(StubEngine));
    let result = handle.cancel_recording("session-99".to_string()).await;
    assert!(result.is_ok(), "cancel when idle should return Ok");
}

#[tokio::test]
async fn multiple_cancel_calls_are_idempotent() {
    let handle = VoiceRuntimeHandle::spawn(Box::new(StubEngine));
    for _ in 0..3 {
        let result = handle.cancel_recording("session-99".to_string()).await;
        assert!(result.is_ok());
    }
}
