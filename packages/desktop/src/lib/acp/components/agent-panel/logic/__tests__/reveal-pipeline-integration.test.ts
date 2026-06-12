// Integration test (U6) for the live agent-panel reveal pipeline.
//
// Drives the exact chain the controller wires after U4 —
//   materializer (cached read-model) -> reveal-text-projection -> token-reveal
// — statefully across a sequence of streaming-turn graph revisions, and asserts
// the RENDERED assistant markdown. The unit tests cover each stage in isolation;
// this proves the orchestration: the materializer's cross-revision caching, the
// reveal-text continuity, and the RevealScenePatch handoff into token-reveal all
// compose correctly. This is the automated counterpart to dev-app streaming QA.

import { describe, expect, it } from "bun:test";

import type { AgentPanelSceneEntryModel } from "@acepe/ui/agent-panel";
import type {
	SessionGraphActivity,
	SessionStateGraph,
	TranscriptEntry,
} from "$lib/services/acp-types.js";
import { createAgentPanelGraphMaterializerReadModel } from "../../../../session-state/agent-panel-graph-materializer.js";
import { createRevealTextProjection } from "../reveal-text-projection.js";
import { createTokenRevealSceneReadModel } from "../token-reveal-scene-read-model.js";

function activity(kind: SessionGraphActivity["kind"]): SessionGraphActivity {
	return {
		kind,
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
		revision: { graphRevision: input.transcriptRevision, transcriptRevision: input.transcriptRevision, lastEventSeq: input.transcriptRevision },
		transcriptSnapshot: { revision: input.transcriptRevision, entries },
		operations: [],
		interactions: [],
		turnState: input.turnState,
		messageCount: entries.length,
		activeTurnFailure: null,
		lastTerminalTurnId: input.turnState === "Completed" ? "turn-1" : null,
		activeStreamingTail: input.streaming ? { rowId: "assistant-1", contentKind: "message" } : null,
		lifecycle: {
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
		},
		activity: input.turnState === "Completed" ? activity("idle") : activity("awaiting_model"),
		capabilities: { models: null, modes: null, availableCommands: [], configOptions: [], autonomousEnabled: false },
	};
}

// Reproduces the controller's pipeline wiring (agent-panel.svelte, U4) for one
// graph revision: materializer -> reveal-text-projection -> token-reveal.
function createPipeline() {
	const materializer = createAgentPanelGraphMaterializerReadModel();
	const projection = createRevealTextProjection();
	const tokenReveal = createTokenRevealSceneReadModel();

	function render(g: SessionStateGraph): {
		markdown: string;
		entries: readonly AgentPanelSceneEntryModel[];
	} {
		const scene = materializer.apply({ panelId: "panel-1", graph: g, header: { title: "Session" } });
		const sceneEntries = scene.conversation.entries;

		// Controller-derived projection input.
		const turnCompleted = g.turnState === "Completed";
		const turnId = g.lastTerminalTurnId ?? `${g.canonicalSessionId}:active`;
		const projected = projection.apply({
			sceneEntries,
			sessionId: g.canonicalSessionId,
			turnId,
			turnCompleted,
		});

		// Controller-derived token-reveal snapshot (CSS omitted — text continuity
		// is independent of the appearance overlay).
		const tailRowId = g.activeStreamingTail?.rowId ?? null;
		const tailIndex = projected.entries.findIndex((e) => e.id === tailRowId);
		const snapshot = {
			sceneEntries: projected.entries,
			scenePatch: projected.scenePatch,
			sourceEntry: tailIndex === -1 ? undefined : projected.entries[tailIndex],
			tailRowId,
			tailRowIndex: tailIndex === -1 ? undefined : tailIndex,
			tokenRevealCss: undefined,
		};
		const rendered =
			tokenReveal.applyPatch(snapshot)?.entries ?? tokenReveal.applySnapshot(snapshot).entries;

		const assistant = rendered.find((e) => e.id === "assistant-1");
		if (assistant?.type !== "assistant") {
			throw new Error("expected assistant-1 in rendered output");
		}
		return { markdown: assistant.markdown, entries: rendered };
	}

	return { render };
}

describe("reveal pipeline integration (materializer -> projection -> token-reveal)", () => {
	it("renders monotonic streaming growth through the full chain", () => {
		const pipeline = createPipeline();
		const seen = [
			pipeline.render(graph({ assistantText: "Hel", turnState: "Running", transcriptRevision: 1, streaming: true })).markdown,
			pipeline.render(graph({ assistantText: "Hello", turnState: "Running", transcriptRevision: 2, streaming: true })).markdown,
			pipeline.render(graph({ assistantText: "Hello world", turnState: "Running", transcriptRevision: 3, streaming: true })).markdown,
		];
		expect(seen).toEqual(["Hel", "Hello", "Hello world"]);
	});

	it("holds visible text when canonical blanks mid-turn, end to end", () => {
		const pipeline = createPipeline();
		expect(
			pipeline.render(graph({ assistantText: "Partial answer in flight", turnState: "Running", transcriptRevision: 1, streaming: true })).markdown
		).toBe("Partial answer in flight");
		// Canonical assistant text transiently empties while the turn runs — the
		// projection must hold, and token-reveal must consume the resulting
		// RevealScenePatch without dropping the held text.
		expect(
			pipeline.render(graph({ assistantText: "", turnState: "Running", transcriptRevision: 2, streaming: true })).markdown
		).toBe("Partial answer in flight");
	});

	it("snaps to canonical on completion through the chain", () => {
		const pipeline = createPipeline();
		pipeline.render(graph({ assistantText: "Visible while running", turnState: "Running", transcriptRevision: 1, streaming: true }));
		expect(
			pipeline.render(graph({ assistantText: "", turnState: "Completed", transcriptRevision: 2, streaming: false })).markdown
		).toBe("");
	});

	it("does not bleed held text across a turn boundary", () => {
		const pipeline = createPipeline();
		pipeline.render(graph({ assistantText: "First turn answer", turnState: "Completed", transcriptRevision: 1, streaming: false }));
		// A fresh turn: lastTerminalTurnId changes -> projection memory resets.
		// Build a graph whose terminal turn id differs and whose assistant is empty.
		const nextTurn = graph({ assistantText: "", turnState: "Running", transcriptRevision: 2, streaming: true });
		expect(pipeline.render(nextTurn).markdown).toBe("");
	});

	it("keeps the user entry stable while the assistant text is held", () => {
		const pipeline = createPipeline();
		pipeline.render(graph({ assistantText: "Held", turnState: "Running", transcriptRevision: 1, streaming: true }));
		const result = pipeline.render(graph({ assistantText: "", turnState: "Running", transcriptRevision: 2, streaming: true }));
		const user = result.entries.find((e) => e.id === "user-1");
		expect(user?.type === "user" ? user.text : null).toBe("Prompt");
	});
});
