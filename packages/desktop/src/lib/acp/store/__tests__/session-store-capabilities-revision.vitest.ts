import { describe, expect, it } from "vitest";

import type {
	SessionGraphActivity,
	SessionGraphCapabilities,
	SessionGraphLifecycle,
	SessionGraphRevision,
	SessionStateGraph,
	SessionStateEnvelope,
} from "$lib/services/acp-types.js";

import { SessionStore } from "../session-store.svelte.js";

function addColdSession(store: SessionStore, sessionId = "session-1"): void {
	store.addSession({
		id: sessionId,
		projectPath: "/repo",
		agentId: "codex",
		title: "Session",
		updatedAt: new Date("2026-04-22T00:00:00.000Z"),
		createdAt: new Date("2026-04-22T00:00:00.000Z"),
		sessionLifecycleState: "persisted",
		parentId: null,
	});
}

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

function createGraphLifecycle(status: SessionGraphLifecycle["status"] = "ready"): SessionGraphLifecycle {
	return {
		status,
		detachedReason: null,
		failureReason: null,
		errorMessage: null,
		actionability: {
			canSend: status === "ready",
			canResume: status === "detached",
			canRetry: status === "failed",
			canArchive: status !== "archived",
			canConfigure: status === "ready",
			recommendedAction: status === "ready" ? "send" : "wait",
			recoveryPhase:
				status === "activating"
					? "activating"
					: status === "reconnecting"
						? "reconnecting"
						: status === "detached"
							? "detached"
							: status === "failed"
								? "failed"
								: status === "archived"
									? "archived"
									: "none",
			compactStatus: status,
		},
	};
}

function createGraph(
	revision: SessionGraphRevision,
	capabilities: SessionGraphCapabilities
): SessionStateGraph {
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
		turnState: "Idle",
		messageCount: 0,
		activeTurnFailure: null,
		lastTerminalTurnId: null,
		lifecycle: createGraphLifecycle(),
		activity: createIdleActivity(),
		capabilities,
	};
}

function seedProjection(
	store: SessionStore,
	revision: SessionGraphRevision,
	capabilities: SessionGraphCapabilities
): void {
	store.applySessionStateGraph(createGraph(revision, capabilities));
}

function createCapabilities(
	currentModeId: string,
	currentModelId: string
): SessionGraphCapabilities {
	return {
		models: {
			currentModelId,
			availableModels: [
				{
					modelId: "gpt-4.1",
					name: "GPT-4.1",
				},
				{
					modelId: "gpt-5",
					name: "GPT-5",
				},
			],
		},
		modes: {
			currentModeId,
			availableModes: [
				{
					id: "build",
					name: "Build",
				},
				{
					id: "plan",
					name: "Plan",
				},
			],
		},
		availableCommands: [],
		configOptions: [],
		autonomousEnabled: false,
	};
}

function createCapabilitiesEnvelope(
	sessionId: string,
	revision: SessionGraphRevision,
	capabilities: SessionGraphCapabilities,
	options?: {
		pendingMutationId?: string | null;
		previewState?: "canonical" | "pending" | "failed" | "partial" | "stale";
	}
): SessionStateEnvelope {
	return {
		sessionId,
		graphRevision: revision.graphRevision,
		lastEventSeq: revision.lastEventSeq,
		payload: {
			kind: "capabilities",
			capabilities,
			revision,
			pending_mutation_id: options?.pendingMutationId ?? null,
			preview_state: options?.previewState ?? "canonical",
		},
	};
}

describe("SessionStore capability revision handling", () => {
	it("applies canonical capabilities envelopes with revision metadata", () => {
		const store = new SessionStore();
		addColdSession(store);
		seedProjection(store, createRevision(6), createCapabilities("build", "gpt-4.1"));

		store.applySessionStateEnvelope(
			"session-1",
			createCapabilitiesEnvelope(
				"session-1",
				createRevision(7),
				createCapabilities("plan", "gpt-5")
			)
		);

		expect(store.getSessionCurrentModeId("session-1")).toBe("plan");
		expect(store.getSessionCurrentModelId("session-1")).toBe("gpt-5");
		expect(store.getSessionCapabilities("session-1")).toMatchObject({
			revision: { graphRevision: 7, transcriptRevision: 7, lastEventSeq: 7 },
			previewState: "canonical",
			pendingMutationId: null,
		});
	});

	it("ignores stale lower-revision capabilities envelopes", () => {
		const store = new SessionStore();
		addColdSession(store);
		seedProjection(store, createRevision(7), createCapabilities("plan", "gpt-5"));

		store.applySessionStateEnvelope(
			"session-1",
			createCapabilitiesEnvelope(
				"session-1",
				createRevision(6),
				createCapabilities("build", "gpt-4.1")
			)
		);

		expect(store.getSessionCurrentModeId("session-1")).toBe("plan");
		expect(store.getSessionCurrentModelId("session-1")).toBe("gpt-5");
		expect(store.getSessionCapabilities("session-1")).toMatchObject({
			revision: { graphRevision: 7, transcriptRevision: 7, lastEventSeq: 7 },
			previewState: "canonical",
		});
	});

	it("projects pending capability envelopes into canonical hot state", () => {
		const store = new SessionStore();
		addColdSession(store);
		seedProjection(store, createRevision(7), createCapabilities("build", "gpt-4.1"));

		store.applySessionStateEnvelope(
			"session-1",
			createCapabilitiesEnvelope(
				"session-1",
				createRevision(8),
				createCapabilities("plan", "gpt-5"),
				{
					pendingMutationId: "mutation-1",
					previewState: "pending",
				}
			)
		);

		expect(store.getSessionCurrentModeId("session-1")).toBe("plan");
		expect(store.getSessionCurrentModelId("session-1")).toBe("gpt-5");
		expect(store.getSessionCapabilities("session-1")).toMatchObject({
			revision: { graphRevision: 8, transcriptRevision: 8, lastEventSeq: 8 },
			previewState: "pending",
			pendingMutationId: "mutation-1",
		});
	});

	it("applies higher failed revisions as corrective envelopes", () => {
		const store = new SessionStore();
		addColdSession(store);
		seedProjection(store, createRevision(7), createCapabilities("build", "gpt-4.1"));

		store.applySessionStateEnvelope(
			"session-1",
			createCapabilitiesEnvelope(
				"session-1",
				createRevision(8),
				createCapabilities("plan", "gpt-5"),
				{
					pendingMutationId: "mutation-1",
					previewState: "pending",
				}
			)
		);
		store.applySessionStateEnvelope(
			"session-1",
			createCapabilitiesEnvelope(
				"session-1",
				createRevision(9),
				createCapabilities("build", "gpt-4.1"),
				{
					previewState: "failed",
				}
			)
		);

		expect(store.getSessionCurrentModeId("session-1")).toBe("build");
		expect(store.getSessionCurrentModelId("session-1")).toBe("gpt-4.1");
		expect(store.getSessionCapabilities("session-1")).toMatchObject({
			revision: { graphRevision: 9, transcriptRevision: 9, lastEventSeq: 9 },
			previewState: "failed",
			pendingMutationId: null,
		});
	});
});
