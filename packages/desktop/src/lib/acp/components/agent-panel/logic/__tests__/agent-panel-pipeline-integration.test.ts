// Integration test for the agent-panel rendered-row pipeline — the real path the
// live transcript viewport uses:
//
//   canonical activity  -> deriveCanonicalAgentPanelSessionState (local placeholder mode)
//   canonical scene     -> sceneEntries (assistant/user)
//   Rust viewport rows  -> buildRenderedTranscriptViewportRows
//                          (resolveTranscriptViewportSceneEntry + planning timing
//                           + local "Planning next moves" row injection)
//
// These tests drive the genuine wiring so a regression in the *rendered* rows
// (what scene-content-viewport actually paints) fails here, regardless of which
// individual unit produced it.

import { describe, expect, it } from "bun:test";

import type { AgentPanelSceneEntryModel } from "@acepe/ui/agent-panel";
import type {
	ActiveStreamingTailContentKind,
	SessionGraphActivity,
	SessionGraphLifecycle,
	SessionTurnState,
	TranscriptViewportRow,
} from "../../../../../services/acp-types.js";
import { resolvePlanningPlaceholderPresentation } from "../planning-placeholder-presentation.js";
import { deriveCanonicalAgentPanelSessionState } from "../session-status-mapper.js";
import { buildRenderedTranscriptViewportRows } from "../transcript-viewport-rendered-rows.js";
import { hasTrailingCompletedTool } from "../transcript-viewport-row-facts.js";

const READY_LIFECYCLE: SessionGraphLifecycle = {
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

const ACTIVATING_LIFECYCLE: SessionGraphLifecycle = {
	status: "activating",
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
		compactStatus: "activating",
	},
};

function activity(kind: SessionGraphActivity["kind"]): SessionGraphActivity {
	return {
		kind,
		activeOperationCount: 0,
		activeSubagentCount: 0,
		dominantOperationId: null,
		blockingInteractionId: null,
	};
}

function userRow(entryId: string, text: string): TranscriptViewportRow {
	return {
		rowId: `transcript:${entryId}`,
		sourceEntryId: entryId,
		kind: "user",
		version: `${entryId}:v1`,
		anchorEligible: true,
		activeStreamingTail: null,
		operationLinks: [],
		interactionLinks: [],
		content: {
			kind: "transcript",
			role: "user",
			segments: [{ kind: "text", segmentId: `${entryId}:s0`, text }],
		},
		durationStartedAtMs: null,
	};
}

function streamingAssistantRow(input: {
	entryId: string;
	text: string;
	tailKind: ActiveStreamingTailContentKind;
	durationStartedAtMs: number;
}): TranscriptViewportRow {
	return {
		rowId: `transcript:${input.entryId}`,
		sourceEntryId: input.entryId,
		kind: input.tailKind === "thought" ? "assistantThought" : "assistantText",
		version: `${input.entryId}:v1`,
		anchorEligible: true,
		activeStreamingTail: input.tailKind,
		operationLinks: [],
		interactionLinks: [],
		content: {
			kind: "transcript",
			role: "assistant",
			segments: [
				{
					kind: input.tailKind === "thought" ? "thought" : "text",
					segmentId: `${input.entryId}:s0`,
					text: input.text,
				},
			],
		},
		durationStartedAtMs: input.durationStartedAtMs,
	};
}

function userEntry(entryId: string, text: string): AgentPanelSceneEntryModel {
	return { id: entryId, type: "user", text };
}

function streamingAssistantEntry(input: {
	entryId: string;
	markdown: string;
	thought?: boolean;
}): AgentPanelSceneEntryModel {
	return {
		id: input.entryId,
		type: "assistant",
		markdown: input.thought === true ? "" : input.markdown,
		message: {
			chunks: [
				{
					type: input.thought === true ? "thought" : "message",
					block: { type: "text", text: input.markdown },
				},
			],
		},
		isStreaming: true,
		planningStartedAtMs: null,
	};
}

function renderTurn(input: {
	activityKind: SessionGraphActivity["kind"];
	turnState: SessionTurnState;
	lifecycle?: SessionGraphLifecycle;
	sceneEntries: readonly AgentPanelSceneEntryModel[];
	bufferRows: readonly TranscriptViewportRow[];
	hasLocalPendingSendIntent?: boolean;
}) {
	const source = {
		kind: "canonical",
		lifecycle: input.lifecycle === undefined ? READY_LIFECYCLE : input.lifecycle,
		activity: activity(input.activityKind),
		turnState: input.turnState,
	} as const;
	const sessionState = deriveCanonicalAgentPanelSessionState({
		source,
		hasEntries: input.sceneEntries.length > 0,
		hasLocalPendingSendIntent: input.hasLocalPendingSendIntent,
		hasTrailingCompletedTool: hasTrailingCompletedTool(input.bufferRows),
	});

	const rendered = buildRenderedTranscriptViewportRows({
		bufferRows: input.bufferRows,
		bufferStartIndex: 0,
		optimisticUserEntry: null,
		localPlaceholderMode: sessionState.localPlaceholderMode,
		planningPlaceholderPresentation: resolvePlanningPlaceholderPresentation({
			agentName: "Codex Agent",
			agentIconSrc: "data:image/svg+xml,hugeicons",
			showWorkingSpark: false,
		}),
	});

	const planningRows = rendered.filter((r) => r.entry.type === "thinking");
	return { localPlaceholderMode: sessionState.localPlaceholderMode, rendered, planningRows };
}

describe("agent-panel rendered-row pipeline — planning placeholder", () => {
	it("does NOT show 'Planning next moves' once the assistant is streaming message text", () => {
		const result = renderTurn({
			activityKind: "awaiting_model",
			turnState: "Running",
			sceneEntries: [
				userEntry("user-1", "why is the sky blue"),
				streamingAssistantEntry({ entryId: "assistant-1", markdown: "The sky is blue because" }),
			],
			bufferRows: [
				userRow("user-1", "why is the sky blue"),
				streamingAssistantRow({
					entryId: "assistant-1",
					text: "The sky is blue because",
					tailKind: "message",
					durationStartedAtMs: 1_700_000_000_000,
				}),
			],
		});

		// The streaming assistant row is present; no separate planning row should be appended.
		expect(result.planningRows).toHaveLength(0);
	});

	it("does NOT show 'Planning next moves' once the assistant is streaming reasoning", () => {
		const result = renderTurn({
			activityKind: "awaiting_model",
			turnState: "Running",
			sceneEntries: [
				userEntry("user-1", "why is the sky blue"),
				streamingAssistantEntry({
					entryId: "assistant-1",
					markdown: "Let me think about Rayleigh scattering",
					thought: true,
				}),
			],
			bufferRows: [
				userRow("user-1", "why is the sky blue"),
				streamingAssistantRow({
					entryId: "assistant-1",
					text: "Let me think about Rayleigh scattering",
					tailKind: "thought",
					durationStartedAtMs: 1_700_000_000_000,
				}),
			],
		});

		expect(result.planningRows).toHaveLength(0);
	});

	it("does not inject a waiting row for a local send intent on an already-ready session", () => {
		// Before canonical turn activity arrives, the sent user row is enough feedback.
		// A ready lifecycle must not look like connection or planning work.
		const result = renderTurn({
			activityKind: "idle",
			turnState: "Completed",
			sceneEntries: [userEntry("user-1", "why is the sky blue")],
			bufferRows: [userRow("user-1", "why is the sky blue")],
			hasLocalPendingSendIntent: true,
		});

		expect(result.localPlaceholderMode).toBe("none");
		expect(result.planningRows).toHaveLength(0);
	});

	it("shows connecting feedback while a pending session is activating", () => {
		const result = renderTurn({
			activityKind: "idle",
			turnState: "Idle",
			lifecycle: ACTIVATING_LIFECYCLE,
			sceneEntries: [userEntry("user-1", "start this session")],
			bufferRows: [userRow("user-1", "start this session")],
			hasLocalPendingSendIntent: true,
		});

		expect(result.localPlaceholderMode).toBe("connection");
		expect(result.planningRows).toHaveLength(1);
		expect(result.planningRows[0]?.localOnly).toBe(true);
		expect(result.planningRows[0]?.row.kind).toBe("localPlaceholder");
		const planningEntry = result.planningRows[0]?.entry;
		expect(planningEntry?.type).toBe("thinking");
		if (planningEntry?.type !== "thinking") {
			return;
		}
		expect(planningEntry.label).toBe("Connecting to Codex Agent");
	});

	it("does NOT show 'Planning next moves' after the canonical turn fails", () => {
		const result = renderTurn({
			activityKind: "awaiting_model",
			turnState: "Failed",
			sceneEntries: [userEntry("user-1", "run this failing command")],
			bufferRows: [userRow("user-1", "run this failing command")],
		});

		expect(result.localPlaceholderMode).toBe("none");
		expect(result.planningRows).toHaveLength(0);
	});
});
