import type { AgentPanelSceneEntryModel } from "@acepe/ui/agent-panel";
import { describe, expect, it } from "vitest";
import type { AgentPanelCanonicalSource } from "../../../../session-state/agent-panel-canonical-source.js";

import {
	type AgentPanelDisplayModel,
	applyAgentPanelDisplayMemory,
	applyAgentPanelDisplayModelToSceneEntries,
	createAgentPanelDisplayMemory,
	createAgentPanelDisplaySceneEntriesReadModel,
	createAgentPanelDisplayRowsReadModel,
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

	it("returns scene entries directly when no assistant display text changed", () => {
		const sceneEntries: readonly AgentPanelSceneEntryModel[] = [
			{ id: "user-1", type: "user", text: "Prompt" },
			{
				id: "assistant-1",
				type: "assistant",
				markdown: "Answer",
				isStreaming: false,
			},
			{
				id: "tool-1",
				type: "tool_call",
				title: "Run",
				status: "done",
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

		expect(
			applyAgentPanelDisplayModelToSceneEntries(
				model,
				createAgentPanelDisplayMemory(),
				sceneEntries
			)
		).toBe(sceneEntries);
	});
});

describe("createAgentPanelDisplaySceneEntriesReadModel", () => {
	it("patches an assistant entry through the cached scene entry index", () => {
		const readModel = createAgentPanelDisplaySceneEntriesReadModel();
		const sceneEntries: readonly AgentPanelSceneEntryModel[] = [
			{ id: "user-1", type: "user", text: "Prompt" },
			{ id: "assistant-1", type: "assistant", markdown: "" },
		];
		const model: AgentPanelDisplayModel = {
			panelId: "panel-1",
			sessionId: "session-1",
			turnId: "turn-1",
			status: "running",
			turnState: "streaming",
			waiting: { show: false, label: null },
			composer: { canSubmit: false, showStop: true },
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

		const displayedEntries = readModel.apply({
			model,
			memory: createAgentPanelDisplayMemory(),
			sceneEntries,
		});

		expect(displayedEntries[0]).toBe(sceneEntries[0]);
		expect(displayedEntries[1]).toMatchObject({
			id: "assistant-1",
			type: "assistant",
			markdown: "Answer",
		});

		expect(
			readModel.apply({
				model: {
					...model,
					status: "connected",
					waiting: { show: true, label: "Planning next moves..." },
				},
				memory: createAgentPanelDisplayMemory(),
				sceneEntries,
			})
		).toBe(displayedEntries);
	});

	it("keeps the cached scene entry index valid after append-only scene updates", () => {
		const readModel = createAgentPanelDisplaySceneEntriesReadModel();
		const userEntry: AgentPanelSceneEntryModel = {
			id: "user-1",
			type: "user",
			text: "Prompt",
		};
		const firstAssistantEntry: AgentPanelSceneEntryModel = {
			id: "assistant-1",
			type: "assistant",
			markdown: "First",
		};
		const nextAssistantEntry: AgentPanelSceneEntryModel = {
			id: "assistant-2",
			type: "assistant",
			markdown: "",
		};
		const firstModel: AgentPanelDisplayModel = {
			panelId: "panel-1",
			sessionId: "session-1",
			turnId: "turn-1",
			status: "running",
			turnState: "streaming",
			waiting: { show: false, label: null },
			composer: { canSubmit: false, showStop: true },
			rows: [
				{
					id: "assistant-1",
					type: "assistant",
					canonicalText: "First",
					displayText: "First",
					canonicalTextRevision: "1:assistant-1",
					isLiveTail: false,
				},
			],
			viewport: { hasLiveTail: false, requiresStableTailMount: false },
		};
		readModel.apply({
			model: firstModel,
			memory: createAgentPanelDisplayMemory(),
			sceneEntries: [userEntry, firstAssistantEntry],
		});

		const nextEntries = readModel.apply({
			model: {
				...firstModel,
				rows: [
					...firstModel.rows,
					{
						id: "assistant-2",
						type: "assistant",
						canonicalText: "Second",
						displayText: "Second",
						canonicalTextRevision: "2:assistant-2",
						isLiveTail: false,
					},
				],
			},
			memory: createAgentPanelDisplayMemory(),
			sceneEntries: [userEntry, firstAssistantEntry, nextAssistantEntry],
		});

		expect(nextEntries[0]).toBe(userEntry);
		expect(nextEntries[1]).toBe(firstAssistantEntry);
		expect(nextEntries[2]).toMatchObject({
			id: "assistant-2",
			type: "assistant",
			markdown: "Second",
		});
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

describe("applyAgentPanelDisplayMemory identity", () => {
	it("reuses displayed rows when source rows and turn state are unchanged", () => {
		const assistantRow = {
			id: "assistant-1",
			type: "assistant" as const,
			canonicalText: "Answer",
			displayText: "Answer",
			canonicalTextRevision: "1:assistant-1",
			isLiveTail: false,
		};
		const baseModel: AgentPanelDisplayModel = {
			panelId: "panel-1",
			sessionId: "session-1",
			turnId: "turn-1",
			status: "connected",
			turnState: "streaming",
			waiting: { show: false, label: null },
			composer: { canSubmit: false, showStop: true },
			rows: [assistantRow],
			viewport: { hasLiveTail: false, requiresStableTailMount: false },
		};

		const firstResult = applyAgentPanelDisplayMemory(createAgentPanelDisplayMemory(), baseModel);
		const secondResult = applyAgentPanelDisplayMemory(firstResult.memory, {
			...baseModel,
			status: "running",
			waiting: { show: true, label: "Planning next moves..." },
		});

		expect(secondResult.model.rows).toBe(firstResult.model.rows);
		expect(secondResult.memory).toBe(firstResult.memory);
		expect(secondResult.model.status).toBe("running");
	});

	it("keeps unchanged assistant rows stable after an append", () => {
		const firstAssistantRow = {
			id: "assistant-1",
			type: "assistant" as const,
			canonicalText: "First answer",
			displayText: "First answer",
			canonicalTextRevision: "1:assistant-1",
			isLiveTail: false,
		};
		const firstModel: AgentPanelDisplayModel = {
			panelId: "panel-1",
			sessionId: "session-1",
			turnId: "turn-1",
			status: "connected",
			turnState: "streaming",
			waiting: { show: false, label: null },
			composer: { canSubmit: false, showStop: true },
			rows: [firstAssistantRow],
			viewport: { hasLiveTail: false, requiresStableTailMount: false },
		};
		const firstResult = applyAgentPanelDisplayMemory(createAgentPanelDisplayMemory(), firstModel);
		const nextAssistantRow = {
			id: "assistant-2",
			type: "assistant" as const,
			canonicalText: "Second answer",
			displayText: "Second answer",
			canonicalTextRevision: "2:assistant-2",
			isLiveTail: false,
		};

		const nextResult = applyAgentPanelDisplayMemory(firstResult.memory, {
			...firstModel,
			rows: [firstResult.model.rows[0]!, nextAssistantRow],
		});

		expect(nextResult.model.rows[0]).toBe(firstResult.model.rows[0]);
		expect(nextResult.model.rows[1]).toBe(nextAssistantRow);
		expect(nextResult.memory.displayTextByRowKey).toBe(firstResult.memory.displayTextByRowKey);
	});

	it("updates only changed same-length rows without rebuilding display text memory", () => {
		const firstAssistantRow = {
			id: "assistant-1",
			type: "assistant" as const,
			canonicalText: "First answer",
			displayText: "First answer",
			canonicalTextRevision: "1:assistant-1",
			isLiveTail: false,
		};
		const secondAssistantRow = {
			id: "assistant-2",
			type: "assistant" as const,
			canonicalText: "Second answer",
			displayText: "Second answer",
			canonicalTextRevision: "1:assistant-2",
			isLiveTail: false,
		};
		const firstModel: AgentPanelDisplayModel = {
			panelId: "panel-1",
			sessionId: "session-1",
			turnId: "turn-1",
			status: "connected",
			turnState: "streaming",
			waiting: { show: false, label: null },
			composer: { canSubmit: false, showStop: true },
			rows: [firstAssistantRow, secondAssistantRow],
			viewport: { hasLiveTail: false, requiresStableTailMount: false },
		};
		const firstResult = applyAgentPanelDisplayMemory(createAgentPanelDisplayMemory(), firstModel);
		const updatedSecondAssistantRow = {
			...secondAssistantRow,
			canonicalText: "Second answer updated",
			displayText: "Second answer updated",
			canonicalTextRevision: "2:assistant-2",
		};

		const nextResult = applyAgentPanelDisplayMemory(firstResult.memory, {
			...firstModel,
			rows: [firstResult.model.rows[0]!, updatedSecondAssistantRow],
		});

		expect(nextResult.model.rows[0]).toBe(firstResult.model.rows[0]);
		expect(nextResult.model.rows[1]).toBe(updatedSecondAssistantRow);
		expect(nextResult.memory.displayTextByRowKey).toBe(firstResult.memory.displayTextByRowKey);
		expect(nextResult.memory.displayTextByRowKey.get("assistant-2")).toBe(
			"Second answer updated"
		);
	});

	it("patches only rows whose display text changes when streaming completes", () => {
		const stableAssistantRow = {
			id: "assistant-1",
			type: "assistant" as const,
			canonicalText: "Stable answer",
			displayText: "Stable answer",
			canonicalTextRevision: "1:assistant-1",
			isLiveTail: false,
		};
		const retainedAssistantRow = {
			id: "assistant-2",
			type: "assistant" as const,
			canonicalText: "",
			displayText: "",
			canonicalTextRevision: "1:assistant-2",
			isLiveTail: true,
		};
		const streamingModel: AgentPanelDisplayModel = {
			panelId: "panel-1",
			sessionId: "session-1",
			turnId: "turn-1",
			status: "running",
			turnState: "streaming",
			waiting: { show: false, label: null },
			composer: { canSubmit: false, showStop: true },
			rows: [stableAssistantRow, retainedAssistantRow],
			viewport: { hasLiveTail: true, requiresStableTailMount: true },
		};
		const streamingResult = applyAgentPanelDisplayMemory(
			{
				...createAgentPanelDisplayMemory(),
				sessionId: "session-1",
				turnId: "turn-1",
				displayTextByRowKey: new Map([["assistant-2", "Retained answer"]]),
				sourceRows: streamingModel.rows,
				displayRows: [
					stableAssistantRow,
					{
						...retainedAssistantRow,
						displayText: "Retained answer",
					},
				],
				turnState: "streaming",
			},
			streamingModel
		);

		const completedResult = applyAgentPanelDisplayMemory(streamingResult.memory, {
			...streamingModel,
			status: "connected",
			turnState: "completed",
			composer: { canSubmit: true, showStop: false },
			viewport: { hasLiveTail: false, requiresStableTailMount: false },
		});

		expect(completedResult.model.rows[0]).toBe(streamingResult.model.rows[0]);
		expect(completedResult.model.rows[1]).not.toBe(streamingResult.model.rows[1]);
		expect(completedResult.model.rows[1]).toMatchObject({
			id: "assistant-2",
			displayText: "",
		});
		expect(completedResult.memory.displayTextByRowKey.get("assistant-1")).toBe(
			"Stable answer"
		);
		expect(completedResult.memory.displayTextByRowKey.get("assistant-2")).toBe("");
	});
});

describe("createAgentPanelDisplayRowsReadModel", () => {
	it("reuses the projection for the same scene entries and transcript revision", () => {
		const readModel = createAgentPanelDisplayRowsReadModel();
		const sceneEntries: readonly AgentPanelSceneEntryModel[] = [
			{ id: "user-1", type: "user", text: "Prompt" },
			{ id: "assistant-1", type: "assistant", markdown: "Answer" },
		];

		const firstProjection = readModel.applySnapshot({
			sceneEntries,
			transcriptRevision: 1,
		});
		const secondProjection = readModel.applySnapshot({
			sceneEntries,
			transcriptRevision: 1,
		});

		expect(secondProjection).toBe(firstProjection);
		expect(readModel.selectProjection()).toBe(firstProjection);
	});

	it("keeps existing display rows stable for append-only scene updates", () => {
		const readModel = createAgentPanelDisplayRowsReadModel();
		const userEntry: AgentPanelSceneEntryModel = {
			id: "user-1",
			type: "user",
			text: "Prompt",
		};
		const assistantEntry: AgentPanelSceneEntryModel = {
			id: "assistant-1",
			type: "assistant",
			markdown: "Answer",
		};
		const firstProjection = readModel.applySnapshot({
			sceneEntries: [userEntry],
			transcriptRevision: 1,
		});

		const nextProjection = readModel.applySnapshot({
			sceneEntries: [userEntry, assistantEntry],
			transcriptRevision: 1,
		});

		expect(nextProjection).not.toBe(firstProjection);
		expect(nextProjection.rows[0]).toBe(firstProjection.rows[0]);
		expect(nextProjection.rows.map((row) => row.id)).toEqual(["user-1", "assistant-1"]);
	});

	it("reuses the projection when scene entries change without visible row changes", () => {
		const readModel = createAgentPanelDisplayRowsReadModel();
		const firstSceneEntries: readonly AgentPanelSceneEntryModel[] = [
			{ id: "user-1", type: "user", text: "Prompt" },
			{ id: "assistant-1", type: "assistant", markdown: "Answer", isStreaming: true },
		];
		const equivalentSceneEntries: readonly AgentPanelSceneEntryModel[] = [
			{ id: "user-1", type: "user", text: "Prompt" },
			{ id: "assistant-1", type: "assistant", markdown: "Answer", isStreaming: true },
		];
		const firstProjection = readModel.applySnapshot({
			sceneEntries: firstSceneEntries,
			transcriptRevision: 1,
		});

		const nextProjection = readModel.applySnapshot({
			sceneEntries: equivalentSceneEntries,
			transcriptRevision: 1,
		});
		const repeatedProjection = readModel.applySnapshot({
			sceneEntries: equivalentSceneEntries,
			transcriptRevision: 1,
		});

		expect(nextProjection).toBe(firstProjection);
		expect(repeatedProjection).toBe(firstProjection);
	});

	it("keeps existing display rows stable when an append advances transcript revision", () => {
		const readModel = createAgentPanelDisplayRowsReadModel();
		const userEntry: AgentPanelSceneEntryModel = {
			id: "user-1",
			type: "user",
			text: "Prompt",
		};
		const assistantEntry: AgentPanelSceneEntryModel = {
			id: "assistant-1",
			type: "assistant",
			markdown: "Answer",
		};
		const firstProjection = readModel.applySnapshot({
			sceneEntries: [userEntry],
			transcriptRevision: 1,
		});

		const nextProjection = readModel.applySnapshot({
			sceneEntries: [userEntry, assistantEntry],
			transcriptRevision: 2,
		});

		expect(nextProjection.rows[0]).toBe(firstProjection.rows[0]);
		expect(nextProjection.rows[1]).toMatchObject({
			id: "assistant-1",
			type: "assistant",
			canonicalTextRevision: "2:assistant-1",
		});
	});

	it("memoizes the next read after an append advances transcript revision", () => {
		const readModel = createAgentPanelDisplayRowsReadModel();
		const userEntry: AgentPanelSceneEntryModel = {
			id: "user-1",
			type: "user",
			text: "Prompt",
		};
		const assistantEntry: AgentPanelSceneEntryModel = {
			id: "assistant-1",
			type: "assistant",
			markdown: "Answer",
		};
		readModel.applySnapshot({
			sceneEntries: [userEntry],
			transcriptRevision: 1,
		});
		const nextSceneEntries = [userEntry, assistantEntry];

		const appendedProjection = readModel.applySnapshot({
			sceneEntries: nextSceneEntries,
			transcriptRevision: 2,
		});
		const repeatedProjection = readModel.applySnapshot({
			sceneEntries: nextSceneEntries,
			transcriptRevision: 2,
		});

		expect(repeatedProjection).toBe(appendedProjection);
	});
});
