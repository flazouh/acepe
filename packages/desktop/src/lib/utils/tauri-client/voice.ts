import {
	type VoiceLanguageOption as ContractVoiceLanguageOption,
	type VoiceModelInfo as ContractVoiceModelInfo,
	decodeSessionId,
	emptyVoiceLanguages,
	emptyVoiceModels,
	emptyVoiceTranscriptionResult,
	type ProjectedVoice,
	placeholderVoiceModel,
	voiceSnapshotRequest,
} from "@acepe/contracts";
import * as Effect from "effect/Effect";

import type { AppError } from "../../acp/errors/app-error.js";
import { AgentError } from "../../acp/errors/app-error.js";
import type {
	TranscriptionResult,
	VoiceLanguageOption,
	VoiceModelInfo,
} from "../../acp/types/voice-input.js";
import { decodeEffect, decodeTrimmed, nextCommandId, withRpcClient } from "./rpc-bridge.ts";

const mapModel = (model: ContractVoiceModelInfo): VoiceModelInfo => ({
	id: model.id,
	name: model.name,
	size_bytes: model.sizeBytes,
	is_english_only: model.isEnglishOnly,
	is_downloaded: model.isDownloaded,
	is_loaded: model.isLoaded,
	download_url: model.downloadUrl,
});

const mapLanguage = (language: ContractVoiceLanguageOption): VoiceLanguageOption => ({
	code: language.code,
	name: language.name,
});

const readVoice = Effect.fn("readVoice")(function* () {
	const snapshot = yield* withRpcClient("voice.snapshot", (client) =>
		client.snapshot(voiceSnapshotRequest())
	);
	return snapshot.voice;
});

const requireVoice = Effect.fn("requireVoice")(function* (operation: string) {
	const voiceState = yield* readVoice();
	if (voiceState === null) {
		return yield* Effect.fail(new AgentError(operation, new Error("voice projection is missing")));
	}
	return voiceState;
});

const requireModel = (
	operation: string,
	modelId: string,
	voiceState: ProjectedVoice
): Effect.Effect<VoiceModelInfo, AgentError> => {
	for (const model of voiceState.models) {
		if (model.id === modelId) {
			return Effect.succeed(mapModel(model));
		}
	}
	if (voiceState.models.length === 1) {
		const only = voiceState.models[0];
		if (only !== undefined) {
			return Effect.succeed(mapModel(only));
		}
	}
	return Effect.fail(new AgentError(operation, new Error(`voice model not found: ${modelId}`)));
};

const decodeSession = (operation: string, sessionId: string) =>
	decodeEffect(operation, decodeSessionId)(sessionId);

export const voice = {
	listModels: Effect.fn("voice.listModels")(function* () {
		const commandId = yield* nextCommandId("voice-models-list");
		yield* withRpcClient("voice.models.list", (client) =>
			client.dispatch({
				type: "voice.models.list",
				commandId,
				models: emptyVoiceModels,
			})
		);
		const voiceState = yield* readVoice();
		if (voiceState === null) {
			return [] as VoiceModelInfo[];
		}
		const models: VoiceModelInfo[] = [];
		for (const model of voiceState.models) {
			models.push(mapModel(model));
		}
		return models;
	}) as () => Effect.Effect<VoiceModelInfo[], AppError>,

	listLanguages: Effect.fn("voice.listLanguages")(function* () {
		const commandId = yield* nextCommandId("voice-languages-list");
		yield* withRpcClient("voice.languages.list", (client) =>
			client.dispatch({
				type: "voice.languages.list",
				commandId,
				languages: emptyVoiceLanguages,
			})
		);
		const voiceState = yield* readVoice();
		if (voiceState === null) {
			return [] as VoiceLanguageOption[];
		}
		const languages: VoiceLanguageOption[] = [];
		for (const language of voiceState.languages) {
			languages.push(mapLanguage(language));
		}
		return languages;
	}) as () => Effect.Effect<VoiceLanguageOption[], AppError>,

	getModelStatus: Effect.fn("voice.getModelStatus")(function* (modelId: string) {
		const commandId = yield* nextCommandId("voice-model-status");
		const decodedModelId = yield* decodeTrimmed("voice.model.status", modelId);
		yield* withRpcClient("voice.model.status", (client) =>
			client.dispatch({
				type: "voice.model.status",
				commandId,
				modelId: decodedModelId,
				model: placeholderVoiceModel(decodedModelId),
			})
		);
		const voiceState = yield* requireVoice("voice.model.status");
		return yield* requireModel("voice.model.status", decodedModelId, voiceState);
	}),

	loadModel: Effect.fn("voice.loadModel")(function* (modelId: string) {
		const commandId = yield* nextCommandId("voice-model-load");
		const decodedModelId = yield* decodeTrimmed("voice.model.load", modelId);
		yield* withRpcClient("voice.model.load", (client) =>
			client.dispatch({
				type: "voice.model.load",
				commandId,
				modelId: decodedModelId,
				model: placeholderVoiceModel(decodedModelId),
			})
		);
	}),

	downloadModel: Effect.fn("voice.downloadModel")(function* (modelId: string) {
		const commandId = yield* nextCommandId("voice-model-download");
		const decodedModelId = yield* decodeTrimmed("voice.model.download", modelId);
		yield* withRpcClient("voice.model.download", (client) =>
			client.dispatch({
				type: "voice.model.download",
				commandId,
				modelId: decodedModelId,
			})
		);
	}),

	deleteModel: Effect.fn("voice.deleteModel")(function* (modelId: string) {
		const commandId = yield* nextCommandId("voice-model-delete");
		const decodedModelId = yield* decodeTrimmed("voice.model.delete", modelId);
		yield* withRpcClient("voice.model.delete", (client) =>
			client.dispatch({
				type: "voice.model.delete",
				commandId,
				modelId: decodedModelId,
			})
		);
	}),

	startRecording: Effect.fn("voice.startRecording")(function* (sessionId: string) {
		const commandId = yield* nextCommandId("voice-recording-start");
		const decodedSessionId = yield* decodeSession("voice.recording.start", sessionId);
		yield* withRpcClient("voice.recording.start", (client) =>
			client.dispatch({
				type: "voice.recording.start",
				commandId,
				sessionId: decodedSessionId,
			})
		);
	}),

	stopRecording: Effect.fn("voice.stopRecording")(function* (
		sessionId: string,
		language: string | null
	) {
		const commandId = yield* nextCommandId("voice-recording-stop");
		const decodedSessionId = yield* decodeSession("voice.recording.stop", sessionId);
		yield* withRpcClient("voice.recording.stop", (client) =>
			client.dispatch({
				type: "voice.recording.stop",
				commandId,
				sessionId: decodedSessionId,
				language,
				result: emptyVoiceTranscriptionResult,
			})
		);
		const voiceState = yield* requireVoice("voice.recording.stop");
		if (voiceState.lastTranscription === null) {
			return {
				text: "",
				language: null,
				duration_ms: 0,
			} satisfies TranscriptionResult;
		}
		return {
			text: voiceState.lastTranscription.text,
			language: voiceState.lastTranscription.language,
			duration_ms: voiceState.lastTranscription.durationMs,
		} satisfies TranscriptionResult;
	}),

	cancelRecording: Effect.fn("voice.cancelRecording")(function* (sessionId: string) {
		const commandId = yield* nextCommandId("voice-recording-cancel");
		const decodedSessionId = yield* decodeSession("voice.recording.cancel", sessionId);
		yield* withRpcClient("voice.recording.cancel", (client) =>
			client.dispatch({
				type: "voice.recording.cancel",
				commandId,
				sessionId: decodedSessionId,
			})
		);
	}),
};
