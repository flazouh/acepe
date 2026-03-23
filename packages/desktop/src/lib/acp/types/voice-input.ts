/** Voice input state machine states */
export type VoiceInputPhase =
	| "idle"
	| "checking_permission"
	| "downloading_model"
	| "recording"
	| "transcribing"
	| "complete"
	| "cancelled"
	| "error";

/** Transcription result from Rust backend */
export interface TranscriptionResult {
	text: string;
	language: string | null;
	duration_ms: number;
}

export interface VoiceLanguageOption {
	code: string;
	name: string;
}

/** Model info from Rust backend */
export interface VoiceModelInfo {
	id: string;
	name: string;
	size_bytes: number;
	is_english_only: boolean;
	is_downloaded: boolean;
	download_url: string;
}

/** Model download progress event payload */
export interface VoiceModelDownloadProgress {
	model_id: string;
	downloaded_bytes: number;
	total_bytes: number;
	percent: number;
}

/** Amplitude event payload (batched 3 values at ~10fps) */
export interface AmplitudePayload {
	session_id: string;
	values: [number, number, number];
}

/** Recording error event payload */
export interface RecordingErrorPayload {
	session_id: string;
	message: string;
}

/** Transcription complete event payload */
export interface TranscriptionCompletePayload {
	session_id: string;
	text: string;
	language: string | null;
	duration_ms: number;
}

/** Transcription error event payload */
export interface TranscriptionErrorPayload {
	session_id: string;
	message: string;
}
