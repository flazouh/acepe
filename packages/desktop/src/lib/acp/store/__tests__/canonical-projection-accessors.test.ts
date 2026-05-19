import { describe, expect, it } from "vitest";

import type {
	InteractionSnapshot,
	SessionGraphActivity,
	SessionGraphCapabilities,
	SessionGraphLifecycle,
	SessionGraphRevision,
	SessionStateGraph,
	TranscriptEntry,
} from "$lib/services/acp-types.js";
import type { ModelsForDisplay } from "$lib/services/acp-provider-metadata.js";

import { SessionStore } from "../session-store.svelte.js";

function createRevision(graphRevision: number): SessionGraphRevision {
	return {
		graphRevision,
		transcriptRevision: graphRevision,
		lastEventSeq: graphRevision,
	};
}

function createIdleActivity(): SessionGraphActivity {
	return {
		kind: "idle",
		activeOperationCount: 0,
		activeSubagentCount: 0,
		dominantOperationId: null,
		blockingInteractionId: null,
	};
}

function createReadyLifecycle(): SessionGraphLifecycle {
	return {
		status: "ready",
		detachedReason: null,
		failureReason: null,
		errorMessage: null,
		actionability: {
			canSend: true,
			canResume: false,
			canRetry: false,
			canArchive: true,
			canConfigure: true,
			recommendedAction: "send",
			recoveryPhase: "none",
			compactStatus: "ready",
		},
	};
}

function createCapabilities(): SessionGraphCapabilities {
	return {
		models: {
			currentModelId: "gpt-5",
			availableModels: [
				{
					modelId: "gpt-5",
					name: "GPT-5",
				},
			],
		},
		modes: {
			currentModeId: "build",
			availableModes: [
				{
					id: "build",
					name: "Build",
				},
			],
		},
		availableCommands: [
			{
				name: "run",
				description: "Run command",
			},
		],
		configOptions: [
			{
				id: "sandbox",
				name: "Sandbox",
				category: "runtime",
				type: "string",
				currentValue: "workspace-write",
			},
		],
		autonomousEnabled: true,
	};
}

function createGraph(
	capabilities: SessionGraphCapabilities,
	entries: TranscriptEntry[] = [],
	interactions: InteractionSnapshot[] = []
): SessionStateGraph {
	const revision = createRevision(7);
	return {
		requestedSessionId: "session-1",
		canonicalSessionId: "session-1",
		isAlias: false,
		agentId: "codex",
		projectPath: "/repo",
		worktreePath: null,
		sourcePath: null,
		revision,
		transcriptSnapshot: {
			revision: revision.transcriptRevision,
			entries,
		},
		operations: [],
		interactions,
		turnState: "Running",
		messageCount: entries.length,
		activeTurnFailure: null,
		lastTerminalTurnId: null,
		activeStreamingTail: null,
		lifecycle: createReadyLifecycle(),
		activity: createIdleActivity(),
		capabilities,
	};
}

function createQuestionInteraction(): InteractionSnapshot {
	return {
		id: "question-1",
		session_id: "session-1",
		kind: "Question",
		state: "Pending",
		json_rpc_request_id: 12,
		reply_handler: null,
		tool_reference: null,
		responded_at_event_seq: null,
		response: null,
		payload: {
			Question: {
				id: "question-1",
				sessionId: "session-1",
				jsonRpcRequestId: 12,
				replyHandler: null,
				questions: [
					{
						question: "Continue?",
						header: "Decision",
						options: [
							{
								label: "Yes",
								description: "Continue the task.",
							},
						],
						multiSelect: false,
					},
				],
				tool: null,
			},
		},
		canonical_operation_id: null,
	};
}

function addColdSession(store: SessionStore): void {
	store.addSession({
		id: "session-1",
		projectPath: "/repo",
		agentId: "codex",
		title: "Session",
		updatedAt: new Date("2026-04-28T00:00:00.000Z"),
		createdAt: new Date("2026-04-28T00:00:00.000Z"),
		sessionLifecycleState: "persisted",
		parentId: null,
	});
}

describe("SessionStore canonical projection accessors", () => {
	it("returns null for canonical-owned scalar values when no canonical projection exists", () => {
		const store = new SessionStore();

		expect(store.getSessionStateGraphForTest("session-1")?.turnState ?? null).toBeNull();
		expect(store.getSessionListState("session-1")).toEqual({
			status: "error",
			isConnected: false,
			isStreaming: false,
		});
		expect(store.getSessionMessageCount("session-1")).toBeNull();
		expect(store.getSessionAgentPanelCanonicalSource("session-1")).toBeNull();
		expect(store.getSessionQuestionInteraction("session-1", "question-1")).toBeNull();
		expect(store.getSessionLiveWorkSource("session-1", true)).toEqual({
			kind: "missing_canonical",
			sessionId: "session-1",
		});
		expect(store.getSessionLiveWorkSource("session-1", false)).toEqual({
			kind: "inactive_session",
			sessionId: "session-1",
		});
		expect(store.hasSessionCanonicalProjection("session-1")).toBe(false);
		expect(store.getSessionLifecycle("session-1")).toBeNull();
		expect(store.getSessionTurnState("session-1")).toBeNull();
		expect(store.getSessionTranscriptEntries("session-1")).toBeNull();
		expect(store.getSessionConnectionError("session-1")).toBeNull();
		expect(store.getSessionActiveTurnFailure("session-1")).toBeNull();
		expect(store.getSessionLastTerminalTurnId("session-1")).toBeNull();
		expect(store.getSessionAutonomousEnabled("session-1")).toBeNull();
		expect(store.getSessionCurrentModeId("session-1")).toBeNull();
		expect(store.getSessionCurrentModelId("session-1")).toBeNull();
		expect(store.getSessionAvailableCommands("session-1")).toBeNull();
		expect(store.getSessionConfigOptions("session-1")).toBeNull();
		expect(store.getSessionAvailableModels("session-1")).toBeNull();
		expect(store.getSessionAvailableModes("session-1")).toBeNull();
		expect(store.hasSessionCanonicalCapabilities("session-1")).toBe(false);
		expect(store.getSessionProviderMetadata("session-1")).toBeNull();
		expect(store.getSessionCapabilityRevision("session-1")).toBeNull();
		expect(store.getSessionCapabilityPreviewState("session-1")).toBeNull();
		expect(store.getSessionCapabilityPendingMutationId("session-1")).toBeNull();
	});

	it("derives all capability accessors from the canonical projection", () => {
		const store = new SessionStore();
		addColdSession(store);
		const transcriptEntries: TranscriptEntry[] = [
			{
				entryId: "entry-1",
				role: "user",
				segments: [{ kind: "text", segmentId: "segment-1", text: "Build the feature" }],
			},
		];

		store.applySessionStateGraph(createGraph(createCapabilities(), transcriptEntries));

		expect(store.getSessionStateGraphForTest("session-1")?.turnState ?? null).toBe("Running");
		const panelSource = store.getSessionAgentPanelCanonicalSource("session-1");
		expect(panelSource?.canonicalSessionId).toBe("session-1");
		expect(panelSource?.transcriptSnapshot.entries).toBe(transcriptEntries);
		expect(panelSource?.operations).toEqual([]);
		expect(panelSource && "capabilities" in panelSource).toBe(false);
		expect(panelSource && "projectPath" in panelSource).toBe(false);
		expect(store.getSessionListState("session-1")).toEqual({
			status: "streaming",
			isConnected: true,
			isStreaming: true,
		});
		expect(store.getSessionMessageCount("session-1")).toBe(1);
		expect(store.getSessionLiveWorkSource("session-1", true)).toMatchObject({
			kind: "canonical",
		});
		expect(store.hasSessionCanonicalProjection("session-1")).toBe(true);
		expect(store.getSessionLifecycle("session-1")).toEqual(createReadyLifecycle());
		expect(store.getSessionTurnState("session-1")).toBe("Running");
		expect(store.getSessionTranscriptEntries("session-1")).toBe(transcriptEntries);
		expect(store.getSessionConnectionError("session-1")).toBeNull();
		expect(store.getSessionLastTerminalTurnId("session-1")).toBeNull();
		expect(store.getSessionAutonomousEnabled("session-1")).toBe(true);
		expect(store.getSessionCurrentModeId("session-1")).toBe("build");
		expect(store.getSessionCurrentModelId("session-1")).toBe("gpt-5");
		expect(store.getSessionAvailableCommands("session-1")).toEqual([
			{
				name: "run",
				description: "Run command",
			},
		]);
		expect(store.getSessionConfigOptions("session-1")).toEqual([
			{
				id: "sandbox",
				name: "Sandbox",
				category: "runtime",
				type: "string",
				currentValue: "workspace-write",
				options: [],
			},
		]);
		expect(store.getSessionAvailableModels("session-1")).toEqual([
			{
				id: "gpt-5",
				name: "GPT-5",
				description: undefined,
			},
		]);
		expect(store.getSessionAvailableModes("session-1")).toEqual([
			{
				id: "build",
				name: "Build",
				description: undefined,
			},
		]);
		expect(store.hasSessionCanonicalCapabilities("session-1")).toBe(true);
		expect(store.getSessionCapabilityRevision("session-1")).toEqual({
			graphRevision: 7,
			transcriptRevision: 7,
			lastEventSeq: 7,
		});
		expect(store.getSessionCapabilityPendingMutationId("session-1")).toBeNull();
		expect(store.getSessionCapabilityPreviewState("session-1")).toBe("canonical");
	});

	it("returns pending question interactions through the question selector only", () => {
		const store = new SessionStore();
		addColdSession(store);
		const questionInteraction = createQuestionInteraction();

		store.applySessionStateGraph(createGraph(createCapabilities(), [], [questionInteraction]));

		expect(store.getSessionQuestionInteraction("session-1", "question-1")).toBe(
			questionInteraction
		);
		expect(store.getSessionQuestionInteraction("session-1", "missing-question")).toBeNull();
	});

	it("preserves missing canonical autonomous state inside materialized capabilities", () => {
		const store = new SessionStore();
		addColdSession(store);

		const capabilities = createCapabilities();
		store.applySessionStateGraph(
			createGraph({
				models: capabilities.models,
				modes: capabilities.modes,
				availableCommands: capabilities.availableCommands,
				configOptions: capabilities.configOptions,
			})
		);

		expect(store.getSessionAutonomousEnabled("session-1")).toBeNull();
	});

	it("preserves missing canonical command and config capability lists", () => {
		const store = new SessionStore();
		addColdSession(store);

		const capabilities = createCapabilities();
		store.applySessionStateGraph(
			createGraph({
				models: capabilities.models,
				modes: capabilities.modes,
				autonomousEnabled: capabilities.autonomousEnabled,
			})
		);

		expect(store.getSessionAvailableCommands("session-1")).toBeNull();
		expect(store.getSessionConfigOptions("session-1")).toBeNull();
	});

	it("preserves missing canonical model and mode capability lists", () => {
		const store = new SessionStore();
		addColdSession(store);

		const capabilities = createCapabilities();
		store.applySessionStateGraph(
			createGraph({
				models: null,
				modes: null,
				availableCommands: capabilities.availableCommands,
				configOptions: capabilities.configOptions,
				autonomousEnabled: capabilities.autonomousEnabled,
			})
		);

		expect(store.getSessionAvailableModels("session-1")).toBeNull();
		expect(store.getSessionAvailableModes("session-1")).toBeNull();
	});

	it("does not synthesize provider display metadata when canonical capabilities omit it", () => {
		const store = new SessionStore();
		addColdSession(store);

		store.applySessionStateGraph(createGraph(createCapabilities()));

		expect(store.getSessionModelsDisplay("session-1")).toBeNull();
		expect(store.getSessionProviderMetadata("session-1")).toBeNull();
	});

	it("reads canonical model display metadata through a narrow selector", () => {
		const store = new SessionStore();
		addColdSession(store);

		const modelsDisplay: ModelsForDisplay = {
			groups: [],
			presentation: {
				displayFamily: "claudeLike",
				usageMetrics: "contextWindowOnly",
			},
		};

		const capabilities = createCapabilities();
		store.applySessionStateGraph(
			createGraph({
				models: {
					currentModelId: capabilities.models?.currentModelId ?? null,
					availableModels: capabilities.models?.availableModels ?? [],
					modelsDisplay,
				},
				modes: capabilities.modes,
				availableCommands: capabilities.availableCommands,
				configOptions: capabilities.configOptions,
				autonomousEnabled: capabilities.autonomousEnabled,
			})
		);

		expect(store.getSessionModelsDisplay("session-1")).toBe(modelsDisplay);
	});

	it("preserves canonical current ids even when display lists omit them", () => {
		const store = new SessionStore();
		addColdSession(store);

		store.applySessionStateGraph(
			createGraph({
				models: {
					currentModelId: "vendor/model-base",
					availableModels: [],
				},
				modes: {
					currentModeId: "code",
					availableModes: [],
				},
				availableCommands: [],
				configOptions: [],
				autonomousEnabled: false,
			})
		);

		expect(store.getSessionCurrentModeId("session-1")).toBe("code");
		expect(store.getSessionCurrentModelId("session-1")).toBe("vendor/model-base");
		expect(store.getSessionAvailableModes("session-1")).toEqual([]);
		expect(store.getSessionAvailableModels("session-1")).toEqual([]);
	});
});
