import { describe, expect, it } from "bun:test";

import type { AgentPanelSceneEntryModel } from "@acepe/ui/agent-panel";
import type {
	SessionGraphActionability,
	SessionGraphActivity,
	SessionGraphCapabilities,
	SessionGraphLifecycle,
	SessionStateGraph,
	TranscriptEntry,
	TranscriptSnapshot,
} from "$lib/services/acp-types.js";
import type { SessionEntry } from "../../../../application/dto/session-entry.js";
import { materializeAgentPanelSceneFromGraph } from "../../../../session-state/agent-panel-graph-materializer.js";
import {
	type AgentPanelDisplayModel,
	type AgentPanelDisplayRow,
	applyAgentPanelDisplayMemory,
	applyAgentPanelDisplayModelToSceneEntries,
	buildAgentPanelBaseModel,
	createAgentPanelDisplayMemory,
} from "../agent-panel-display-model.js";

function createActionability(canSend = true): SessionGraphActionability {
	return {
		canSend,
		canResume: false,
		canRetry: false,
		canArchive: true,
		canConfigure: true,
		recommendedAction: canSend ? "send" : "wait",
		recoveryPhase: "none",
		compactStatus: "ready",
	};
}

function createLifecycle(canSend = true): SessionGraphLifecycle {
	return {
		status: "ready",
		detachedReason: null,
		failureReason: null,
		errorMessage: null,
		actionability: createActionability(canSend),
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

function createAwaitingModelActivity(): SessionGraphActivity {
	return {
		kind: "awaiting_model",
		activeOperationCount: 0,
		activeSubagentCount: 0,
		dominantOperationId: null,
		blockingInteractionId: null,
	};
}

function createCapabilities(): SessionGraphCapabilities {
	return {
		models: null,
		modes: null,
		availableCommands: [],
		configOptions: [],
		autonomousEnabled: false,
	};
}

function createTranscriptEntry(
	entryId: string,
	role: TranscriptEntry["role"],
	text: string
): TranscriptEntry {
	return {
		entryId,
		role,
		segments: [
			{
				kind: "text",
				segmentId: `${entryId}-segment-1`,
				text,
			},
		],
		attemptId: null,
	};
}

function createTranscriptSnapshot(entries: readonly TranscriptEntry[]): TranscriptSnapshot {
	return {
		revision: 12,
		entries: Array.from(entries),
	};
}

function createGraph(input: {
	readonly entries: readonly TranscriptEntry[];
	readonly turnState: SessionStateGraph["turnState"];
	readonly activity: SessionGraphActivity;
	readonly canSend?: boolean;
	readonly lastAgentMessageId?: string | null;
	readonly transcriptRevision?: number;
}): SessionStateGraph {
	const transcriptSnapshot = createTranscriptSnapshot(input.entries);
	const transcriptRevision = input.transcriptRevision ?? transcriptSnapshot.revision;
	return {
		requestedSessionId: "session-1",
		canonicalSessionId: "session-1",
		isAlias: false,
		agentId: "claude-code",
		projectPath: "/repo",
		worktreePath: null,
		sourcePath: null,
		revision: {
			graphRevision: 20,
			transcriptRevision,
			lastEventSeq: 99,
		},
		transcriptSnapshot: {
			revision: transcriptRevision,
			entries: Array.from(input.entries),
		},
		operations: [],
		interactions: [],
		turnState: input.turnState,
		messageCount: input.entries.length,
		lastAgentMessageId: input.lastAgentMessageId ?? null,
		activeTurnFailure: null,
		lastTerminalTurnId: input.turnState === "Completed" ? "turn-1" : null,
		activeStreamingTail: null,
		lifecycle: createLifecycle(input.canSend ?? true),
		activity: input.activity,
		capabilities: createCapabilities(),
	};
}

function createPendingUserEntry(): SessionEntry {
	return {
		id: "pending-user-1",
		type: "user",
		message: {
			content: { type: "text", text: "Pending prompt" },
			chunks: [{ type: "text", text: "Pending prompt" }],
			sentAt: new Date("2026-05-06T00:00:00.000Z"),
		},
		timestamp: new Date("2026-05-06T00:00:00.000Z"),
	};
}

function buildModel(
	graph: SessionStateGraph | null,
	pendingUserEntry: SessionEntry | null = null,
	agentName: string | null = null
) {
	const scene = materializeAgentPanelSceneFromGraph({
		panelId: "panel-1",
		graph,
		header: {
			title: "Session",
		},
		optimistic:
			pendingUserEntry === null
				? null
				: {
						pendingUserEntry,
					},
	});
	return buildAgentPanelBaseModel({
		panelId: "panel-1",
		graph,
		header: {
			title: "Session",
			agentName,
		},
		sceneEntries: scene.conversation.entries,
		local: {
			pendingSendIntent: pendingUserEntry !== null,
		},
	});
}

function findAssistantRow(
	model: AgentPanelDisplayModel,
	rowId: string
): Extract<AgentPanelDisplayRow, { type: "assistant" }> {
	const row = model.rows.find((candidate) => candidate.id === rowId);
	if (row?.type !== "assistant") {
		throw new Error(`Expected assistant row ${rowId}`);
	}
	return row;
}

describe("agent panel display model", () => {
	it("uses completed canonical graph state to clear waiting", () => {
		const graph = createGraph({
			entries: [
				createTranscriptEntry("user-1", "user", "Prompt"),
				createTranscriptEntry("assistant-1", "assistant", "Done"),
			],
			turnState: "Completed",
			activity: createIdleActivity(),
			lastAgentMessageId: "assistant-1",
		});

		const model = buildModel(graph);

		expect(model.status).toBe("done");
		expect(model.waiting).toEqual({ show: false, label: null });
		expect(model.composer.showStop).toBe(false);
	});

	it("keeps a stale running canonical graph in control of visible state", () => {
		const graph = createGraph({
			entries: [createTranscriptEntry("user-1", "user", "Prompt")],
			turnState: "Running",
			activity: createAwaitingModelActivity(),
			canSend: false,
		});

		const model = buildAgentPanelBaseModel({
			panelId: "panel-1",
			graph,
			header: {
				title: "Session",
			},
			sceneEntries: materializeAgentPanelSceneFromGraph({
				panelId: "panel-1",
				graph,
				header: { title: "Session" },
			}).conversation.entries,
			local: {
				pendingSendIntent: false,
			},
		});

		expect(model.status).toBe("running");
		expect(model.turnState).toBe("streaming");
		expect(model.waiting).toEqual({ show: true, label: "Planning next moves..." });
		expect(model.composer.showStop).toBe(true);
	});

	it("does not show the planning placeholder once assistant text is streaming", () => {
		const graph = createGraph({
			entries: [
				createTranscriptEntry("user-1", "user", "Prompt"),
				createTranscriptEntry("assistant-1", "assistant", "Streaming answer"),
			],
			turnState: "Running",
			activity: createAwaitingModelActivity(),
			canSend: false,
			lastAgentMessageId: "assistant-1",
		});

		const model = buildAgentPanelBaseModel({
			panelId: "panel-1",
			graph,
			header: {
				title: "Session",
			},
			sceneEntries: materializeAgentPanelSceneFromGraph({
				panelId: "panel-1",
				graph,
				header: { title: "Session" },
			}).conversation.entries,
			local: {
				pendingSendIntent: false,
			},
		});

		expect(model.turnState).toBe("streaming");
		expect(model.waiting).toEqual({ show: false, label: null });
		expect(model.composer.showStop).toBe(true);
	});

	it("renders pre-session pending user entry without inventing canonical state", () => {
		const model = buildModel(null, createPendingUserEntry(), "Claude Opus 4.7");

		expect(model.status).toBe("warming");
		expect(model.waiting).toEqual({ show: true, label: "Connecting to Claude Opus 4.7..." });
		expect(model.rows).toEqual([
			{
				id: "pending-user-1",
				type: "user",
				text: "Pending prompt",
				isOptimistic: true,
			},
		]);
	});

	it("uses scene materializer ordering for pending user rows", () => {
		const graph = createGraph({
			entries: [createTranscriptEntry("assistant-1", "assistant", "Tool output arrived first")],
			turnState: "Running",
			activity: createAwaitingModelActivity(),
			canSend: false,
			lastAgentMessageId: "assistant-1",
		});

		const model = buildModel(graph, createPendingUserEntry());

		expect(model.rows[0]?.id).toBe("assistant-1");
		expect(model.rows[1]).toEqual({
			id: "pending-user-1",
			type: "user",
			text: "Pending prompt",
			isOptimistic: true,
		});
	});

	it("keeps display text non-blank during same-key running replacement", () => {
		const memory = createAgentPanelDisplayMemory();
		const firstGraph = createGraph({
			entries: [
				createTranscriptEntry("user-1", "user", "Prompt"),
				createTranscriptEntry("assistant-1", "assistant", "Umbrellas stay visible"),
			],
			turnState: "Running",
			activity: createAwaitingModelActivity(),
			canSend: false,
			lastAgentMessageId: "assistant-1",
		});
		const firstResult = applyAgentPanelDisplayMemory(memory, buildModel(firstGraph));
		const firstAssistant = findAssistantRow(firstResult.model, "assistant-1");
		expect(firstAssistant.displayText).toBe("Umbrellas stay visible");

		const replacementGraph = createGraph({
			entries: [
				createTranscriptEntry("user-1", "user", "Prompt"),
				createTranscriptEntry("assistant-1", "assistant", ""),
			],
			turnState: "Running",
			activity: createAwaitingModelActivity(),
			canSend: false,
			lastAgentMessageId: "assistant-1",
			transcriptRevision: 13,
		});
		const replacementResult = applyAgentPanelDisplayMemory(
			firstResult.memory,
			buildModel(replacementGraph)
		);
		const replacementAssistant = findAssistantRow(replacementResult.model, "assistant-1");

		expect(replacementAssistant.canonicalText).toBe("");
		expect(replacementAssistant.displayText).toBe("Umbrellas stay visible");
	});

	it("does not let display memory hide completed canonical text", () => {
		const runningGraph = createGraph({
			entries: [
				createTranscriptEntry("user-1", "user", "Prompt"),
				createTranscriptEntry("assistant-1", "assistant", "Visible while running"),
			],
			turnState: "Running",
			activity: createAwaitingModelActivity(),
			canSend: false,
			lastAgentMessageId: "assistant-1",
		});
		const firstResult = applyAgentPanelDisplayMemory(
			createAgentPanelDisplayMemory(),
			buildModel(runningGraph)
		);
		const completedGraph = createGraph({
			entries: [
				createTranscriptEntry("user-1", "user", "Prompt"),
				createTranscriptEntry("assistant-1", "assistant", ""),
			],
			turnState: "Completed",
			activity: createIdleActivity(),
			lastAgentMessageId: "assistant-1",
			transcriptRevision: 14,
		});

		const completedResult = applyAgentPanelDisplayMemory(
			firstResult.memory,
			buildModel(completedGraph)
		);
		const completedAssistant = findAssistantRow(completedResult.model, "assistant-1");

		expect(completedAssistant.canonicalText).toBe("");
		expect(completedAssistant.displayText).toBe("");
	});

	it("keeps bursty assistant updates bounded to one assistant row", () => {
		let result = applyAgentPanelDisplayMemory(createAgentPanelDisplayMemory(), buildModel(null));
		for (let index = 1; index <= 150; index += 1) {
			const graph = createGraph({
				entries: [
					createTranscriptEntry("user-1", "user", "Prompt"),
					createTranscriptEntry("assistant-1", "assistant", `chunk ${String(index)}`),
				],
				turnState: "Running",
				activity: createAwaitingModelActivity(),
				canSend: false,
				lastAgentMessageId: "assistant-1",
				transcriptRevision: 100 + index,
			});
			result = applyAgentPanelDisplayMemory(result.memory, buildModel(graph));
		}

		expect(result.model.rows.map((row) => row.id)).toEqual(["user-1", "assistant-1"]);
		expect(findAssistantRow(result.model, "assistant-1").displayText).toBe("chunk 150");
		expect(result.memory.displayTextByRowKey.size).toBe(1);
	});

	it("applies display text to assistant scene entries while preserving non-assistant rows", () => {
		const firstGraph = createGraph({
			entries: [
				createTranscriptEntry("user-1", "user", "Prompt"),
				createTranscriptEntry("assistant-1", "assistant", "Visible answer"),
			],
			turnState: "Running",
			activity: createAwaitingModelActivity(),
			canSend: false,
			lastAgentMessageId: "assistant-1",
		});
		const firstResult = applyAgentPanelDisplayMemory(
			createAgentPanelDisplayMemory(),
			buildModel(firstGraph)
		);
		const replacementGraph = createGraph({
			entries: [
				createTranscriptEntry("user-1", "user", "Prompt"),
				createTranscriptEntry("assistant-1", "assistant", ""),
			],
			turnState: "Running",
			activity: createAwaitingModelActivity(),
			canSend: false,
			lastAgentMessageId: "assistant-1",
			transcriptRevision: 15,
		});
		const replacementResult = applyAgentPanelDisplayMemory(
			firstResult.memory,
			buildModel(replacementGraph)
		);
		const toolEntry: Extract<AgentPanelSceneEntryModel, { type: "tool_call" }> = {
			id: "tool-1",
			type: "tool_call",
			kind: "execute",
			title: "Run command",
			status: "done",
		};
		const sceneEntries: readonly AgentPanelSceneEntryModel[] = [
			{ id: "user-1", type: "user", text: "Prompt" },
			{
				id: "assistant-1",
				type: "assistant",
				markdown: "",
				message: {
					chunks: [
						{ type: "message", block: { type: "text", text: "" } },
						{ type: "message", block: { type: "resource", resource: { uri: "file://a" } } },
					],
				},
				isStreaming: true,
			},
			toolEntry,
		];

		const displayedEntries = applyAgentPanelDisplayModelToSceneEntries(
			replacementResult.model,
			replacementResult.memory,
			sceneEntries
		);
		const assistantEntry = displayedEntries[1];

		expect(displayedEntries[2]).toBe(toolEntry);
		expect(assistantEntry?.type).toBe("assistant");
		if (assistantEntry?.type !== "assistant") {
			throw new Error("Expected assistant scene entry");
		}
		expect(assistantEntry.markdown).toBe("Visible answer");
		expect(assistantEntry.tokenRevealCss).toBeUndefined();
		expect(assistantEntry.message?.chunks[0]).toEqual({
			type: "message",
			block: { type: "text", text: "Visible answer" },
		});
		expect(assistantEntry.message?.chunks[1]).toEqual({
			type: "message",
			block: { type: "resource", resource: { uri: "file://a" } },
		});
	});

	it("keeps text around non-text assistant chunks in canonical order", () => {
		const graph = createGraph({
			entries: [
				createTranscriptEntry("user-1", "user", "Prompt"),
				createTranscriptEntry("assistant-1", "assistant", "Alpha Beta text"),
			],
			turnState: "Running",
			activity: createAwaitingModelActivity(),
			canSend: false,
			lastAgentMessageId: "assistant-1",
		});
		const displayResult = applyAgentPanelDisplayMemory(
			createAgentPanelDisplayMemory(),
			buildModel(graph)
		);
		const sceneEntries: readonly AgentPanelSceneEntryModel[] = [
			{
				id: "assistant-1",
				type: "assistant",
				markdown: "",
				message: {
					chunks: [
						{ type: "message", block: { type: "text", text: "Alpha " } },
						{ type: "message", block: { type: "resource", resource: { uri: "file://a" } } },
						{ type: "message", block: { type: "text", text: "Beta text" } },
					],
				},
				isStreaming: true,
			},
		];

		const displayedEntries = applyAgentPanelDisplayModelToSceneEntries(
			displayResult.model,
			displayResult.memory,
			sceneEntries
		);
		const assistantEntry = displayedEntries[0];

		expect(assistantEntry?.type).toBe("assistant");
		if (assistantEntry?.type !== "assistant") {
			throw new Error("Expected assistant scene entry");
		}
		expect(assistantEntry.message?.chunks).toEqual([
			{ type: "message", block: { type: "text", text: "Alpha " } },
			{ type: "message", block: { type: "resource", resource: { uri: "file://a" } } },
			{ type: "message", block: { type: "text", text: "Beta text" } },
		]);
	});

	it("preserves inactive scene entry objects while applying display text to the live row", () => {
		const graph = createGraph({
			entries: [
				createTranscriptEntry("user-1", "user", "Prompt"),
				createTranscriptEntry("assistant-history", "assistant", "Historical answer"),
				createTranscriptEntry("assistant-live", "assistant", "Live answer keeps revealing"),
			],
			turnState: "Running",
			activity: createAwaitingModelActivity(),
			canSend: false,
			lastAgentMessageId: "assistant-live",
		});
		const displayResult = applyAgentPanelDisplayMemory(
			createAgentPanelDisplayMemory(),
			buildModel(graph)
		);
		const historyEntry: AgentPanelSceneEntryModel = {
			id: "assistant-history",
			type: "assistant",
			markdown: "Historical answer",
			isStreaming: false,
		};
		const liveEntry: AgentPanelSceneEntryModel = {
			id: "assistant-live",
			type: "assistant",
			markdown: "",
			isStreaming: true,
		};

		const displayedEntries = applyAgentPanelDisplayModelToSceneEntries(
			displayResult.model,
			displayResult.memory,
			[historyEntry, liveEntry]
		);

		expect(displayedEntries[0]).toBe(historyEntry);
		expect(displayedEntries[1]).not.toBe(liveEntry);
		expect(displayedEntries[1]?.type).toBe("assistant");
		if (displayedEntries[1]?.type !== "assistant") {
			throw new Error("Expected live assistant scene entry");
		}
		expect(displayedEntries[1].markdown).toBe("Live answer keeps revealing");
	});
});
