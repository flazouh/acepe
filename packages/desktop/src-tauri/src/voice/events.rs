// Model download events
pub const VOICE_MODEL_DOWNLOAD_PROGRESS_EVENT: &str = "voice://model_download_progress";
pub const VOICE_MODEL_DOWNLOAD_COMPLETE_EVENT: &str = "voice://model_download_complete";
pub const VOICE_MODEL_DOWNLOAD_ERROR_EVENT: &str = "voice://model_download_error";

// Recording lifecycle events
/// ~10 Hz; payload: AmplitudePayload { session_id, values: [f32; 3] }
pub const VOICE_AMPLITUDE_EVENT: &str = "voice://amplitude";
/// Emitted on device disconnect or duration limit.
pub const VOICE_RECORDING_ERROR_EVENT: &str = "voice://recording_error";
/// Emitted after successful stop + transcription.
pub const VOICE_TRANSCRIPTION_COMPLETE_EVENT: &str = "voice://transcription_complete";
/// Emitted when transcription engine returns an error after stop.
pub const VOICE_TRANSCRIPTION_ERROR_EVENT: &str = "voice://transcription_error";
