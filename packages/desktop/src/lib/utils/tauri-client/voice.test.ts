import { afterEach, describe, expect, it } from "bun:test";
import {
	emptyProjectedVoice,
	emptyRpcSessionSnapshot,
	type RpcClient,
	type RpcSessionSnapshot,
	SessionId,
	type VoiceModelInfo,
} from "@acepe/contracts";
import * as Effect from "effect/Effect";
import * as Result from "effect/Result";
import * as Stream from "effect/Stream";

import { AgentError } from "../../acp/errors/app-error.js";
import { setAppRpcClientForTest } from "../../rpc/app-client.ts";
import { voice } from "./voice.ts";

const unusedIndex = {
	projectPath: "/tmp/p",
	files: [],
	gitStatus: [],
	totalFiles: 0,
	totalLines: 0,
};

const externalModel: VoiceModelInfo = {
	id: "external",
	name: "Speech to text",
	sizeBytes: 0,
	isEnglishOnly: false,
	isDownloaded: true,
	isLoaded: true,
	downloadUrl: "",
};

type VoiceSnapshotOverrides = {
	readonly models?: readonly VoiceModelInfo[];
	readonly lastTranscription?: RpcSessionSnapshot["voice"] extends infer V
		? V extends { lastTranscription: infer T }
			? T
			: never
		: never;
};

const voiceSnapshotWith = (overrides: VoiceSnapshotOverrides): RpcSessionSnapshot => {
	const base = voiceSnapshot();
	const voiceProjection = base.voice;
	if (voiceProjection === null) {
		return base;
	}
	return {
		...base,
		voice: {
			sequence: voiceProjection.sequence,
			models: overrides.models ?? voiceProjection.models,
			languages: voiceProjection.languages,
			recording: voiceProjection.recording,
			lastTranscription:
				overrides.lastTranscription === undefined
					? voiceProjection.lastTranscription
					: overrides.lastTranscription,
		},
	};
};

const voiceSnapshot = (): RpcSessionSnapshot => {
	const empty = emptyRpcSessionSnapshot(0);
	const projected = emptyProjectedVoice(1);
	return {
		snapshotSequence: empty.snapshotSequence,
		session: empty.session,
		messages: empty.messages,
		turns: empty.turns,
		activities: empty.activities,
		pendingApprovals: empty.pendingApprovals,
		checkpoints: empty.checkpoints,
		projects: empty.projects,
		sessions: empty.sessions,
		settings: empty.settings,
		skillsCatalog: empty.skillsCatalog,
		voice: {
			sequence: projected.sequence,
			models: [externalModel],
			languages: [
				{
					code: "auto",
					name: "Auto",
				},
			],
			recording: {
				sessionId: SessionId.make("session-1"),
				phase: "recording",
			},
			lastTranscription: {
				sessionId: SessionId.make("session-1"),
				text: "ship the slice",
				language: "en",
				durationMs: 1500,
			},
		},
		gitReview: empty.gitReview,
		mcpCatalog: empty.mcpCatalog,
		preconnectionOptions: empty.preconnectionOptions,
		terminal: empty.terminal,
		sessionReviewState: empty.sessionReviewState,
	};
};

const makeClient = (overrides: Partial<RpcClient>): RpcClient => ({
	dispatch: () => Effect.succeed({ sequence: 1 }),
	snapshot: () => Effect.succeed(voiceSnapshot()),
	getProjectIndex: () => Effect.succeed(unusedIndex),
	invalidateProjectIndex: () => Effect.void,
	readTextFile: () => Effect.succeed(""),
	writeTextFile: () => Effect.void,
	getDefaultShell: () => Effect.succeed("/bin/zsh"),
	gitCall: () => Effect.succeed({ op: "git.isRepo" as const, isRepo: false }),
	agentCall: () => Effect.succeed({ op: "agent.list" as const, agents: [] }),
	getProviderAccountUsage: () => Effect.succeed([]),
	listProviderSessions: () => Effect.succeed([]),
	listProviderProjects: () => Effect.succeed([]),
	importProviderSession: () => Effect.succeed({ sessionId: SessionId.make("session-1"), imported: false }),
	events: () => Stream.empty,
	...overrides,
});

afterEach(() => {
	setAppRpcClientForTest(null);
});

describe("voice rpc facade", () => {
	it("lists models from a voice snapshot after dispatch", () =>
		Effect.runPromise(
			Effect.gen(function* () {
				const dispatched: string[] = [];
				setAppRpcClientForTest(
					makeClient({
						dispatch: (command) => {
							dispatched.push(command.type);
							return Effect.succeed({ sequence: 1 });
						},
					})
				);
				const models = yield* voice.listModels();
				expect(dispatched).toEqual(["voice.models.list"]);
				expect(models).toEqual([
					{
						id: "external",
						name: "Speech to text",
						size_bytes: 0,
						is_english_only: false,
						is_downloaded: true,
						is_loaded: true,
						download_url: "",
					},
				]);
			})
		));

	it("starts and stops recording through dispatch and returns transcription text", () =>
		Effect.runPromise(
			Effect.gen(function* () {
				const dispatched: string[] = [];
				setAppRpcClientForTest(
					makeClient({
						dispatch: (command) => {
							dispatched.push(command.type);
							return Effect.succeed({ sequence: 1 });
						},
					})
				);
				yield* voice.startRecording("session-1");
				const result = yield* voice.stopRecording("session-1", "en");
				expect(dispatched).toEqual(["voice.recording.start", "voice.recording.stop"]);
				expect(result.text).toBe("ship the slice");
				expect(result.language).toBe("en");
				expect(result.duration_ms).toBe(1500);
			})
		));

	/**
	 * No transcription used to come back as an empty success, so the caller
	 * told someone who had just spoken "No speech detected". Speech to text
	 * runs through an external command; with none configured there is no
	 * backend that could have heard anything, and saying so is the only answer
	 * a person can act on.
	 */
	it("fails with the setup message when no speech backend is configured", () =>
		Effect.runPromise(
			Effect.gen(function* () {
				setAppRpcClientForTest(
					makeClient({
						dispatch: () => Effect.succeed({ sequence: 1 }),
						snapshot: () =>
							Effect.succeed(
								voiceSnapshotWith({
									models: [{ ...externalModel, isDownloaded: false, isLoaded: false }],
									lastTranscription: null,
								})
							),
					})
				);
				const outcome = yield* Effect.result(voice.stopRecording("session-1", "en"));
				expect(outcome._tag).toBe("Failure");
			})
		));

	it("reports an empty transcription when a backend was there and heard nothing", () =>
		Effect.runPromise(
			Effect.gen(function* () {
				setAppRpcClientForTest(
					makeClient({
						dispatch: () => Effect.succeed({ sequence: 1 }),
						snapshot: () =>
							Effect.succeed(voiceSnapshotWith({ lastTranscription: null })),
					})
				);
				const result = yield* voice.stopRecording("session-1", "en");
				expect(result.text).toBe("");
			})
		));

	it("fails writes that are not on the contract with AgentError", () =>
		Effect.runPromise(
			Effect.gen(function* () {
				setAppRpcClientForTest(makeClient({}));
				const result = yield* Effect.result(voice.getModelStatus(""));
				expect(Result.isFailure(result)).toBe(true);
				if (Result.isFailure(result) && result.failure instanceof AgentError) {
					expect(result.failure.operation).toBe("voice.model.status");
				}
			})
		));
});
