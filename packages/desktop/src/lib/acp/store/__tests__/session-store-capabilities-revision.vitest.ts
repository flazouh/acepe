import { describe, expect, it } from "vitest";

import type {
	SessionGraphCapabilities,
	SessionGraphRevision,
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

function createCapabilities(currentModeId: string, currentModelId: string): SessionGraphCapabilities {
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

		store.applySessionStateEnvelope(
			"session-1",
			createCapabilitiesEnvelope(
				"session-1",
				createRevision(7),
				createCapabilities("plan", "gpt-5")
			)
		);

		expect(store.getHotState("session-1")).toMatchObject({
			currentMode: { id: "plan" },
			currentModel: { id: "gpt-5" },
		});
		expect(store.getCapabilities("session-1")).toMatchObject({
			revision: { graphRevision: 7, transcriptRevision: 7, lastEventSeq: 7 },
			previewState: "canonical",
			pendingMutationId: null,
		});
	});

	it("ignores stale lower-revision capabilities envelopes", () => {
		const store = new SessionStore();
		addColdSession(store);

		store.applySessionStateEnvelope(
			"session-1",
			createCapabilitiesEnvelope(
				"session-1",
				createRevision(7),
				createCapabilities("plan", "gpt-5")
			)
		);
		store.applySessionStateEnvelope(
			"session-1",
			createCapabilitiesEnvelope(
				"session-1",
				createRevision(6),
				createCapabilities("build", "gpt-4.1")
			)
		);

		expect(store.getHotState("session-1")).toMatchObject({
			currentMode: { id: "plan" },
			currentModel: { id: "gpt-5" },
		});
		expect(store.getCapabilities("session-1")).toMatchObject({
			revision: { graphRevision: 7, transcriptRevision: 7, lastEventSeq: 7 },
			previewState: "canonical",
		});
	});

	it("projects pending capability envelopes into canonical hot state", () => {
		const store = new SessionStore();
		addColdSession(store);

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

		expect(store.getHotState("session-1")).toMatchObject({
			currentMode: { id: "plan" },
			currentModel: { id: "gpt-5" },
		});
		expect(store.getCapabilities("session-1")).toMatchObject({
			revision: { graphRevision: 8, transcriptRevision: 8, lastEventSeq: 8 },
			previewState: "pending",
			pendingMutationId: "mutation-1",
		});
	});

	it("applies higher failed revisions as corrective envelopes", () => {
		const store = new SessionStore();
		addColdSession(store);

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

		expect(store.getHotState("session-1")).toMatchObject({
			currentMode: { id: "build" },
			currentModel: { id: "gpt-4.1" },
		});
		expect(store.getCapabilities("session-1")).toMatchObject({
			revision: { graphRevision: 9, transcriptRevision: 9, lastEventSeq: 9 },
			previewState: "failed",
			pendingMutationId: null,
		});
	});
});
