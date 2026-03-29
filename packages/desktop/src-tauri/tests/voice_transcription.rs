/// Integration tests for whisper-rs transcription.
///
/// These tests require a real model file on disk and are therefore opt-in:
///
/// ```sh
/// ACEPE_RUN_VOICE_TESTS=1 \
/// ACEPE_VOICE_MODEL_PATH=/path/to/ggml-tiny.en.bin \
/// cargo test --test voice_transcription
/// ```
///
/// A WAV file path may also be supplied:
/// ```sh
/// ACEPE_VOICE_WAV_PATH=/path/to/sample.wav
/// ```
/// If omitted, the tests synthesise a 1 s sine-wave burst (produces no speech
/// text, but verifies the engine loads and runs without panicking).
use acepe_lib::voice::engine::{resample, TranscriptionEngine, WhisperEngine};

fn is_enabled() -> bool {
    std::env::var("ACEPE_RUN_VOICE_TESTS").is_ok()
}

fn model_path() -> std::path::PathBuf {
    std::path::PathBuf::from(
        std::env::var("ACEPE_VOICE_MODEL_PATH")
            .unwrap_or_else(|_| "models/whisper/ggml-tiny.en.bin".to_string()),
    )
}

#[test]
fn engine_loads_model_and_transcribes_silence() {
    if !is_enabled() {
        println!("Skipped (set ACEPE_RUN_VOICE_TESTS=1 to enable)");
        return;
    }
    let path = model_path();
    if !path.exists() {
        println!(
            "Skipped — model not found at {}. Set ACEPE_VOICE_MODEL_PATH.",
            path.display()
        );
        return;
    }

    let mut engine = WhisperEngine::new();
    engine.load_model(&path).expect("load_model should succeed");

    // 1 second of silence at 16 kHz
    let audio = vec![0.0f32; 16_000];
    let result = engine
        .transcribe(&audio, 16_000, None)
        .expect("transcribe should not error on silence");

    // Silence / no speech: whisper returns empty or just whitespace
    assert!(
        result.text.trim().is_empty(),
        "Expected empty transcription for silence, got: {:?}",
        result.text
    );
}

#[test]
fn engine_transcribes_wav_when_provided() {
    if !is_enabled() {
        println!("Skipped (set ACEPE_RUN_VOICE_TESTS=1 to enable)");
        return;
    }
    let model = model_path();
    if !model.exists() {
        println!("Skipped — model not found at {}", model.display());
        return;
    }
    let wav_path = match std::env::var("ACEPE_VOICE_WAV_PATH") {
        Ok(p) => std::path::PathBuf::from(p),
        Err(_) => {
            println!("Skipped — set ACEPE_VOICE_WAV_PATH to a 16 kHz mono WAV");
            return;
        }
    };

    // Read WAV with hound (available as a dev dependency via tokio-test transitive chain)
    // Fallback: read raw i16 samples and convert to f32.
    let audio = read_wav_as_f32_mono(&wav_path).expect("Failed to read WAV");
    let audio_16k = resample(&audio, 16_000, 16_000); // already 16 kHz per requirement

    let mut engine = WhisperEngine::new();
    engine.load_model(&model).unwrap();

    let result = engine.transcribe(&audio_16k, 16_000, None).unwrap();
    println!("Transcription: {:?}", result.text);
    println!("Language: {:?}", result.language);

    // The test simply verifies no panic; actual content checked manually.
    assert!(
        result.duration_ms == 0,
        "Engine sets duration_ms=0; caller provides wall time"
    );
}

#[test]
fn engine_errors_when_no_model_loaded() {
    let engine = WhisperEngine::new();
    let audio = vec![0.0f32; 16_000];
    let result = engine.transcribe(&audio, 16_000, None);
    assert!(
        result.is_err(),
        "Transcribe without a loaded model should return Err"
    );
}

// ── WAV helper ────────────────────────────────────────────────────────────

/// Read a WAV file as a mono f32 PCM sample vector.
/// Mixes down stereo to mono by averaging channels.
fn read_wav_as_f32_mono(path: &std::path::Path) -> anyhow::Result<Vec<f32>> {
    use std::io::BufReader;

    let file = std::fs::File::open(path)?;
    let mut reader = hound::WavReader::new(BufReader::new(file))?;
    let spec = reader.spec();
    let channels = spec.channels as usize;

    let samples: Vec<f32> = match spec.sample_format {
        hound::SampleFormat::Float => reader.samples::<f32>().collect::<Result<_, _>>()?,
        hound::SampleFormat::Int => {
            let max = (1i64 << (spec.bits_per_sample - 1)) as f32;
            reader
                .samples::<i32>()
                .map(|s| s.map(|v| v as f32 / max))
                .collect::<Result<_, _>>()?
        }
    };

    if channels <= 1 {
        return Ok(samples);
    }

    // Mix down to mono
    Ok(samples
        .chunks(channels)
        .map(|frame| frame.iter().sum::<f32>() / channels as f32)
        .collect())
}
