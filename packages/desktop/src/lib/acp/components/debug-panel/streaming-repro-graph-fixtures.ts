import type { AgentPanelSceneEntryModel } from "@acepe/ui/agent-panel";
import type { AgentPanelGraphMaterializerInput } from "$lib/acp/session-state/agent-panel-graph-materializer.js";
import type {
	SessionGraphActionability,
	SessionGraphActivity,
	SessionGraphCapabilities,
	SessionGraphLifecycle,
	SessionStateGraph,
	TranscriptEntry,
	TranscriptSnapshot,
} from "$lib/services/acp-types.js";

import {
	DEFAULT_STREAMING_REPRO_PRESETS,
	resolveStreamingReproActiveTailRowId,
	type StreamingReproPhase,
	type StreamingReproPreset,
} from "./streaming-repro-controller";

function createActionability(): SessionGraphActionability {
	return {
		canSend: true,
		canResume: false,
		canRetry: false,
		canArchive: true,
		canConfigure: true,
		recommendedAction: "send",
		recoveryPhase: "none",
		compactStatus: "ready",
	};
}

function createLifecycle(): SessionGraphLifecycle {
	return {
		status: "ready",
		actionability: createActionability(),
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
		segments:
			text.length === 0
				? []
				: [
						{
							kind: "text",
							segmentId: `${entryId}-segment-1`,
							text,
						},
					],
		attemptId: null,
	};
}

function createTranscriptSnapshot(entries: TranscriptEntry[]): TranscriptSnapshot {
	return {
		revision: entries.length + 1,
		entries,
	};
}

function createActivity(phase: StreamingReproPhase): SessionGraphActivity {
	return {
		kind: phase.activityKind,
		activeOperationCount: 0,
		activeSubagentCount: 0,
		dominantOperationId: null,
		blockingInteractionId: null,
	};
}

function createGraph(phase: StreamingReproPhase): SessionStateGraph {
	const activeStreamingTailRowId =
		phase.assistantStreaming === true ? resolveStreamingReproActiveTailRowId(phase) : null;
	const transcriptEntries: TranscriptEntry[] = [
		createTranscriptEntry("user-1", "user", "Explain umbrellas slowly."),
	];
	if (phase.activeStreamingTailRowId !== null) {
		transcriptEntries.push(
			createTranscriptEntry(phase.activeStreamingTailRowId, "assistant", phase.assistantText)
		);
	}

	const transcriptSnapshot = createTranscriptSnapshot(transcriptEntries);

	return {
		requestedSessionId: "streaming-repro-session",
		canonicalSessionId: "streaming-repro-session",
		isAlias: false,
		agentId: "claude-code",
		projectPath: "/debug/repro",
		worktreePath: null,
		sourcePath: null,
		revision: {
			graphRevision: transcriptSnapshot.revision,
			transcriptRevision: transcriptSnapshot.revision,
			lastEventSeq: transcriptSnapshot.revision,
		},
		transcriptSnapshot,
		operations: [],
		interactions: [],
		turnState: phase.turnState,
		messageCount: transcriptEntries.length,
		activeTurnFailure: null,
		lastTerminalTurnId: phase.turnState === "Completed" ? "turn-1" : null,
		activeStreamingTail:
			activeStreamingTailRowId === null
				? null
				: { rowId: activeStreamingTailRowId, contentKind: "message" },
		lifecycle: createLifecycle(),
		activity: createActivity(phase),
		capabilities: createCapabilities(),
	};
}

export function getStreamingReproPresetById(presetId: string): StreamingReproPreset {
	const preset = DEFAULT_STREAMING_REPRO_PRESETS.find((candidate) => candidate.id === presetId);
	if (!preset) {
		throw new Error(`Unknown streaming repro preset: ${presetId}`);
	}
	return preset;
}

export function buildStreamingReproGraphMaterializerInput(input: {
	readonly panelId: string;
	readonly preset: StreamingReproPreset;
	readonly phase: StreamingReproPhase;
}): AgentPanelGraphMaterializerInput {
	return {
		panelId: input.panelId,
		graph: createGraph(input.phase),
		header: {
			title: input.preset.name,
			subtitle: input.phase.label,
			agentLabel: "Claude Code",
			projectLabel: "Streaming repro lab",
			projectColor: "#6D28D9",
		},
		optimistic: null,
	};
}

export function applyStreamingReproPhaseSceneOverrides(input: {
	readonly entries: readonly AgentPanelSceneEntryModel[];
	readonly phase: StreamingReproPhase;
}): readonly AgentPanelSceneEntryModel[] {
	if (input.phase.assistantMessageChunks === undefined) {
		return input.entries;
	}

	const activeStreamingTailRowId = resolveStreamingReproActiveTailRowId(input.phase);
	const entries: AgentPanelSceneEntryModel[] = [];
	for (const entry of input.entries) {
		if (
			entry.type === "assistant" &&
			activeStreamingTailRowId !== null &&
			entry.id === activeStreamingTailRowId
		) {
			entries.push({
				id: entry.id,
				type: "assistant",
				markdown: entry.markdown,
				message: {
					chunks: input.phase.assistantMessageChunks,
					model: entry.message?.model,
					displayModel: entry.message?.displayModel,
					receivedAt: entry.message?.receivedAt,
					thinkingDurationMs: entry.message?.thinkingDurationMs,
				},
				isStreaming: entry.isStreaming,
				timestampMs: entry.timestampMs,
			});
			continue;
		}
		entries.push(entry);
	}
	return entries;
}
