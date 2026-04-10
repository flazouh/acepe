import type { ResultAsync } from "neverthrow";
import type { AppError } from "../../acp/errors/app-error.js";
import type { VoiceLanguageOption, VoiceModelInfo } from "../../acp/types/voice-input.js";
import { invokeAsync } from "./invoke.js";

export const voice = {
	listModels: (): ResultAsync<VoiceModelInfo[], AppError> =>
		invokeAsync<VoiceModelInfo[]>("voice_list_models"),

	listLanguages: (): ResultAsync<VoiceLanguageOption[], AppError> =>
		invokeAsync<VoiceLanguageOption[]>("voice_list_languages"),

	getModelStatus: (modelId: string): ResultAsync<VoiceModelInfo, AppError> =>
		invokeAsync<VoiceModelInfo>("voice_get_model_status", { modelId }),

	loadModel: (modelId: string): ResultAsync<void, AppError> =>
		invokeAsync<void>("voice_load_model", { modelId }),

	downloadModel: (modelId: string): ResultAsync<void, AppError> =>
		invokeAsync<void>("voice_download_model", { modelId }),

	deleteModel: (modelId: string): ResultAsync<void, AppError> =>
		invokeAsync<void>("voice_delete_model", { modelId }),

	startRecording: (sessionId: string): ResultAsync<void, AppError> =>
		invokeAsync<void>("voice_start_recording", { sessionId }),

	stopRecording: (sessionId: string, language: string | null): ResultAsync<void, AppError> =>
		invokeAsync<void>("voice_stop_recording", { sessionId, language }),

	cancelRecording: (sessionId: string): ResultAsync<void, AppError> =>
		invokeAsync<void>("voice_cancel_recording", { sessionId }),
};
