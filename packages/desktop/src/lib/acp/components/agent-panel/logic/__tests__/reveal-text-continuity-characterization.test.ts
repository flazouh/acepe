// Characterization net for U1 of the display-model retirement plan
// (docs/plans/2026-06-09-001-refactor-retire-agent-panel-display-model-plan.md).
//
// These tests assert on the RENDERED assistant `markdown` (what the user sees),
// independent of the display-model's internal `row.displayText`/`row.canonicalText`
// shape. That makes them the behaviour-level contract U2 must reproduce when the
// displayText streaming-continuity is rehomed into the reveal-projection layer,
// and they survive the U5 deletion of agent-panel-display-model.ts (whose own
// tests assert on internals and are deleted with it).
//
// Load-bearing fact this locks: during a running turn the canonical assistant
// markdown can transition non-empty -> empty (a "same-key running replacement",
// also documented in docs/solutions/ui-bugs/assistant-text-reveal-streaming-block.md).
// The continuity holds the previously-visible text so the row never blanks.

import { describe, expect, it } from "bun:test";

import type { AgentPanelSceneEntryModel } from "@acepe/ui/agent-panel";
import type {
	SessionGraphActivity,
	SessionGraphLifecycle,
	SessionStateGraph,
	TranscriptEntry,
} from "$lib/services/acp-types.js";
import { materializeAgentPanelSceneFromGraph } from "../../../../session-state/agent-panel-graph-materializer.js";
import {
	applyAgentPanelDisplayMemory,
	buildAgentPanelBaseModel,
	createAgentPanelDisplayMemory,
	type AgentPanelDisplayMemory,
} from "../agent-panel-display-model.js";
import { applyAgentPanelDisplayModelToSceneEntries } from "../agent-panel-display-scene-test-helper.js";

function lifecycle(): SessionGraphLifecycle {
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

function awaitingModel(): SessionGraphActivity {
	return {
		kind: "awaiting_model",
		activeOperationCount: 0,
		activeSubagentCount: 0,
		dominantOperationId: null,
		blockingInteractionId: null,
	};
}

function idle(): SessionGraphActivity {
	return {
		kind: "idle",
		activeOperationCount: 0,
		activeSubagentCount: 0,
		dominantOperationId: null,
		blockingInteractionId: null,
	};
}

function entry(entryId: string, role: TranscriptEntry["role"], text: string): TranscriptEntry {
	return {
		entryId,
		role,
		segments: [{ kind: "text", segmentId: `${entryId}-s1`, text }],
		attemptId: null,
	};
}

function graph(input: {
	assistantText: string;
	turnState: SessionStateGraph["turnState"];
	transcriptRevision: number;
	streaming: boolean;
}): SessionStateGraph {
	const entries: TranscriptEntry[] = [
		entry("user-1", "user", "Prompt"),
		entry("assistant-1", "assistant", input.assistantText),
	];
	return {
		requestedSessionId: "session-1",
		canonicalSessionId: "session-1",
		isAlias: false,
		agentId: "claude-code",
		projectPath: "/repo",
		worktreePath: null,
		sourcePath: null,
		revision: { graphRevision: 20, transcriptRevision: input.transcriptRevision, lastEventSeq: 99 },
		transcriptSnapshot: { revision: input.transcriptRevision, entries },
		operations: [],
		interactions: [],
		turnState: input.turnState,
		messageCount: entries.length,
		activeTurnFailure: null,
		lastTerminalTurnId: input.turnState === "Completed" ? "turn-1" : null,
		activeStreamingTail: input.streaming ? { rowId: "assistant-1", contentKind: "message" } : null,
		lifecycle: lifecycle(),
		activity: input.turnState === "Completed" ? idle() : awaitingModel(),
		capabilities: {
			models: null,
			modes: null,
			availableCommands: [],
			configOptions: [],
			autonomousEnabled: false,
		},
	};
}

// Drives one revision through the full display pipeline and returns the RENDERED
// assistant markdown plus the carried memory for the next revision.
function renderAssistant(
	g: SessionStateGraph,
	memory: AgentPanelDisplayMemory
): { markdown: string; memory: AgentPanelDisplayMemory } {
	const sceneEntries = materializeAgentPanelSceneFromGraph({
		panelId: "panel-1",
		graph: g,
		header: { title: "Session" },
	}).conversation.entries;
	const base = buildAgentPanelBaseModel({
		panelId: "panel-1",
		graph: g,
		header: { title: "Session", agentName: null },
		sceneEntries,
		local: { pendingSendIntent: false },
	});
	const applied = applyAgentPanelDisplayMemory(memory, base);
	const rendered = applyAgentPanelDisplayModelToSceneEntries(
		applied.model,
		applied.memory,
		sceneEntries
	);
	return { markdown: assistantMarkdown(rendered), memory: applied.memory };
}

function assistantMarkdown(entries: readonly AgentPanelSceneEntryModel[]): string {
	const found = entries.find((candidate) => candidate.id === "assistant-1");
	if (found?.type !== "assistant") {
		throw new Error("expected assistant-1 scene entry");
	}
	return found.markdown;
}

describe("reveal-text continuity (rendered-output characterization)", () => {
	it("renders full markdown for completed cold history", () => {
		const { markdown } = renderAssistant(
			graph({
				assistantText: "Final answer",
				turnState: "Completed",
				transcriptRevision: 12,
				streaming: false,
			}),
			createAgentPanelDisplayMemory()
		);
		expect(markdown).toBe("Final answer");
	});

	it("renders latest canonical text during monotonic streaming growth", () => {
		let memory = createAgentPanelDisplayMemory();
		const steps = ["Hel", "Hello", "Hello world"];
		const seen: string[] = [];
		steps.forEach((text, index) => {
			const result = renderAssistant(
				graph({
					assistantText: text,
					turnState: "Running",
					transcriptRevision: 12 + index,
					streaming: true,
				}),
				memory
			);
			memory = result.memory;
			seen.push(result.markdown);
		});
		expect(seen).toEqual(["Hel", "Hello", "Hello world"]);
	});

	it("holds visible markdown when canonical blanks mid-turn (same-key running replacement)", () => {
		let memory = createAgentPanelDisplayMemory();
		const first = renderAssistant(
			graph({
				assistantText: "Partial answer in flight",
				turnState: "Running",
				transcriptRevision: 12,
				streaming: true,
			}),
			memory
		);
		expect(first.markdown).toBe("Partial answer in flight");
		memory = first.memory;

		// Canonical assistant text transiently empties while the turn is still running.
		const blanked = renderAssistant(
			graph({
				assistantText: "",
				turnState: "Running",
				transcriptRevision: 13,
				streaming: true,
			}),
			memory
		);
		// The continuity holds the previously-visible text — the row does not blank.
		expect(blanked.markdown).toBe("Partial answer in flight");
	});

	it("snaps rendered markdown to canonical on completion even when empty", () => {
		let memory = createAgentPanelDisplayMemory();
		const running = renderAssistant(
			graph({
				assistantText: "Visible while running",
				turnState: "Running",
				transcriptRevision: 12,
				streaming: true,
			}),
			memory
		);
		expect(running.markdown).toBe("Visible while running");
		memory = running.memory;

		const completed = renderAssistant(
			graph({
				assistantText: "",
				turnState: "Completed",
				transcriptRevision: 13,
				streaming: false,
			}),
			memory
		);
		// On completion the continuity must NOT hide canonical truth — it snaps to "".
		expect(completed.markdown).toBe("");
	});
});
