import type { AgentPanelSceneEntryModel } from "@acepe/ui/agent-panel";
import { describe, expect, it } from "vitest";
import type { AgentPanelCanonicalSource } from "../../../../session-state/agent-panel-canonical-source.js";

import {
	type AgentPanelDisplayModel,
	applyAgentPanelDisplayModelToSceneEntries,
	createAgentPanelDisplayMemory,
} from "../agent-panel-display-model.js";

describe("applyAgentPanelDisplayModelToSceneEntries identity", () => {
	it("keeps the scene entries array stable when display rows do not change entries", () => {
		const sceneEntries: readonly AgentPanelSceneEntryModel[] = [
			{ id: "user-1", type: "user", text: "Prompt" },
			{
				id: "assistant-1",
				type: "assistant",
				markdown: "Answer",
				isStreaming: false,
			},
		];
		const model: AgentPanelDisplayModel = {
			panelId: "panel-1",
			sessionId: "session-1",
			turnId: null,
			status: "connected",
			turnState: "idle",
			waiting: { show: false, label: null },
			composer: { canSubmit: true, showStop: false },
			rows: [
				{ id: "user-1", type: "user", text: "Prompt" },
				{
					id: "assistant-1",
					type: "assistant",
					canonicalText: "Answer",
					displayText: "Answer",
					canonicalTextRevision: "1:assistant-1",
					isLiveTail: false,
				},
			],
			viewport: { hasLiveTail: false, requiresStableTailMount: false },
		};

		const displayedEntries = applyAgentPanelDisplayModelToSceneEntries(
			model,
			createAgentPanelDisplayMemory(),
			sceneEntries
		);

		expect(displayedEntries).toBe(sceneEntries);
	});
});

describe("buildAgentPanelBaseModel row projection", () => {
	it("uses projected live-tail state without changing visible model behavior", async () => {
		const { buildAgentPanelBaseModel } = await import("../agent-panel-display-model.js");
		const graph = {
			canonicalSessionId: "session-1",
			revision: { transcriptRevision: 7 },
			lifecycle: {
				status: "ready",
				detachedReason: null,
				failureReason: null,
				errorMessage: null,
				actionability: {
					canSend: false,
					canResume: false,
					canRetry: false,
					canArchive: true,
					canConfigure: true,
					recommendedAction: "wait",
					recoveryPhase: "none",
					compactStatus: "ready",
				},
			},
			activity: {
				kind: "awaiting_model",
				activeOperationCount: 0,
				activeSubagentCount: 0,
				dominantOperationId: null,
				blockingInteractionId: null,
			},
			turnState: "Running",
			lastTerminalTurnId: null,
		} as unknown as AgentPanelCanonicalSource;

		const model = buildAgentPanelBaseModel({
			panelId: "panel-1",
			graph,
			header: { title: "Session" },
			sceneEntries: [
				{ id: "user-1", type: "user", text: "Prompt" },
				{
					id: "assistant-1",
					type: "assistant",
					markdown: "Streaming",
					isStreaming: true,
				},
			],
			local: { pendingSendIntent: false },
		});

		expect(model.waiting).toEqual({ show: false, label: null });
		expect(model.viewport).toEqual({
			hasLiveTail: true,
			requiresStableTailMount: true,
		});
	});
});
