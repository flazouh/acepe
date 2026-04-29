import { describe, expect, it } from "vitest";

import type {
	SessionGraphActivity,
	SessionGraphCapabilities,
	SessionGraphLifecycle,
	SessionGraphRevision,
	SessionStateGraph,
} from "$lib/services/acp-types.js";

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

function createGraph(capabilities: SessionGraphCapabilities): SessionStateGraph {
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
			entries: [],
		},
		operations: [],
		interactions: [],
		turnState: "Running",
		messageCount: 0,
		activeTurnFailure: null,
		lastTerminalTurnId: null,
		lifecycle: createReadyLifecycle(),
		activity: createIdleActivity(),
		capabilities,
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
	it("returns neutral values when no canonical projection exists", () => {
		const store = new SessionStore();

		expect(store.getSessionTurnState("session-1")).toBeNull();
		expect(store.getSessionConnectionError("session-1")).toBeNull();
		expect(store.getSessionActiveTurnFailure("session-1")).toBeNull();
		expect(store.getSessionLastTerminalTurnId("session-1")).toBeNull();
		expect(store.getSessionAutonomousEnabled("session-1")).toBe(false);
		expect(store.getSessionCurrentModeId("session-1")).toBeNull();
		expect(store.getSessionCurrentModelId("session-1")).toBeNull();
		expect(store.getSessionAvailableCommands("session-1")).toEqual([]);
		expect(store.getSessionConfigOptions("session-1")).toEqual([]);
		expect(store.getSessionAvailableModels("session-1")).toEqual([]);
		expect(store.getSessionAvailableModes("session-1")).toEqual([]);
		expect(store.getSessionCapabilities("session-1")).toEqual({
			availableModels: [],
			availableModes: [],
			availableCommands: [],
			revision: null,
			pendingMutationId: null,
			previewState: "partial",
		});
	});

	it("derives all capability accessors from the canonical projection", () => {
		const store = new SessionStore();
		addColdSession(store);

		store.applySessionStateGraph(createGraph(createCapabilities()));

		expect(store.getSessionTurnState("session-1")).toBe("Running");
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
		expect(store.getSessionCapabilities("session-1")).toMatchObject({
			availableModels: [
				{
					id: "gpt-5",
					name: "GPT-5",
				},
			],
			availableModes: [
				{
					id: "build",
					name: "Build",
				},
			],
			availableCommands: [
				{
					name: "run",
					description: "Run command",
				},
			],
			revision: {
				graphRevision: 7,
				transcriptRevision: 7,
				lastEventSeq: 7,
			},
			pendingMutationId: null,
			previewState: "canonical",
		});
	});
});
