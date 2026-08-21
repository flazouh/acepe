import * as Effect from "effect/Effect";
import type { AppError } from "../../acp/errors/app-error.js";
import type { VoiceLanguageOption, VoiceModelInfo } from "../../acp/types/voice-input.js";
import { invokeAsync } from "./invoke.js";

export const voice = {
	listModels: (): Effect.Effect<VoiceModelInfo[], AppError> =>
		invokeAsync<VoiceModelInfo[]>("voice_list_models"),

	listLanguages: (): Effect.Effect<VoiceLanguageOption[], AppError> =>
		invokeAsync<VoiceLanguageOption[]>("voice_list_languages"),

	getModelStatus: (modelId: string): Effect.Effect<VoiceModelInfo, AppError> =>
		invokeAsync<VoiceModelInfo>("voice_get_model_status", { modelId }),

	loadModel: (modelId: string): Effect.Effect<void, AppError> =>
		invokeAsync<void>("voice_load_model", { modelId }),

	downloadModel: (modelId: string): Effect.Effect<void, AppError> =>
		invokeAsync<void>("voice_download_model", { modelId }),

	deleteModel: (modelId: string): Effect.Effect<void, AppError> =>
		invokeAsync<void>("voice_delete_model", { modelId }),

	startRecording: (sessionId: string): Effect.Effect<void, AppError> =>
		invokeAsync<void>("voice_start_recording", { sessionId }),

	stopRecording: (sessionId: string, language: string | null): Effect.Effect<void, AppError> =>
		invokeAsync<void>("voice_stop_recording", { sessionId, language }),

	cancelRecording: (sessionId: string): Effect.Effect<void, AppError> =>
		invokeAsync<void>("voice_cancel_recording", { sessionId }),
};
