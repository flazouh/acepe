// Integration test for the agent-panel rendered-row pipeline — the real path the
// live transcript viewport uses:
//
//   canonical activity  -> deriveCanonicalAgentPanelSessionState (showPlanningIndicator)
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
import { deriveCanonicalAgentPanelSessionState } from "../session-status-mapper.js";
import { buildRenderedTranscriptViewportRows } from "../transcript-viewport-rendered-rows.js";

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
	sceneEntries: readonly AgentPanelSceneEntryModel[];
	bufferRows: readonly TranscriptViewportRow[];
	planningPlaceholderPresentation?: {
		readonly label: string;
		readonly agentIconSrc: string | null;
		readonly showWorkingSpark: boolean;
	} | null;
}) {
	// Canonical fact: the model is producing output when any row has an active
	// streaming tail (message text OR reasoning).
	const hasActiveStreamingTail = input.bufferRows.some(
		(row) => row.activeStreamingTail !== null
	);
	const sessionState = deriveCanonicalAgentPanelSessionState({
		source: {
			kind: "canonical",
			lifecycle: READY_LIFECYCLE,
			activity: activity(input.activityKind),
			turnState: input.turnState,
		},
		hasEntries: input.sceneEntries.length > 0,
		hasActiveStreamingTail,
	});

	const rendered = buildRenderedTranscriptViewportRows({
		bufferRows: input.bufferRows,
		bufferStartIndex: 0,
		optimisticUserEntry: null,
		showLocalPlanningIndicator: sessionState.showPlanningIndicator,
		planningPlaceholderPresentation: input.planningPlaceholderPresentation ?? null,
	});

	const planningRows = rendered.filter(
		(r) => r.entry.type === "thinking" || r.row.kind === "awaitingPlaceholder"
	);
	return { showPlanningIndicator: sessionState.showPlanningIndicator, rendered, planningRows };
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

	it("shows a branded connecting row while awaiting the model with no output yet", () => {
		// Only a user row, model awaiting, nothing streamed: the local placeholder
		// tells the user which agent is still connecting.
		const result = renderTurn({
			activityKind: "awaiting_model",
			turnState: "Running",
			sceneEntries: [userEntry("user-1", "why is the sky blue")],
			bufferRows: [userRow("user-1", "why is the sky blue")],
			planningPlaceholderPresentation: {
				label: "Connecting to Codex Agent",
				agentIconSrc: "/svgs/agents/codex/codex-icon.svg",
				showWorkingSpark: false,
			},
		});

		expect(result.showPlanningIndicator).toBe(true);
		expect(result.planningRows.length).toBeGreaterThan(0);
		const planningEntry = result.planningRows[0]?.entry;
		expect(planningEntry?.type).toBe("thinking");
		if (planningEntry?.type !== "thinking") {
			return;
		}
		expect(planningEntry.label).toBe("Connecting to Codex Agent");
		expect(planningEntry.agentIconSrc).toBe("/svgs/agents/codex/codex-icon.svg");
		expect(planningEntry.showWorkingSpark).toBe(false);
	});

	it("does NOT show 'Planning next moves' after the canonical turn fails", () => {
		const result = renderTurn({
			activityKind: "awaiting_model",
			turnState: "Failed",
			sceneEntries: [userEntry("user-1", "run this failing command")],
			bufferRows: [userRow("user-1", "run this failing command")],
		});

		expect(result.showPlanningIndicator).toBe(false);
		expect(result.planningRows).toHaveLength(0);
	});
});
