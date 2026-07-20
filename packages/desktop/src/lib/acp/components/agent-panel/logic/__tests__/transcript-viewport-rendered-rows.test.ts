import { describe, expect, it } from "bun:test";
import type { AgentPanelSceneEntryModel } from "@acepe/ui/agent-panel";
import type {
	OperationSnapshot,
	TranscriptViewportRow,
} from "../../../../../services/acp-types.js";
import type { AgentPanelCanonicalSource } from "../../../../session-state/agent-panel-canonical-source.js";
import { createViewportOperationSceneEntryResolver } from "../../../../session-state/viewport-operation-scene-entry-resolver.js";
import { renderKey } from "../../../../store/transcript-rows-store.js";
import { createAgentPanelStressFixture } from "../../../../testing/agent-panel-stress-fixture.js";
import {
	buildRenderableTranscriptViewportRows,
	buildRenderedTranscriptViewportRows,
	createRenderableTranscriptViewportRowSource,
	createRenderedTranscriptViewportRowResolver,
} from "../transcript-viewport-rendered-rows.js";

function createOptimisticUserEntry(
	id: string,
	text: string,
	timestampMs?: number
): AgentPanelSceneEntryModel {
	return {
		id,
		type: "user",
		text,
		isOptimistic: true,
		timestampMs,
	};
}

function createCanonicalUserEntry(id: string, text: string): AgentPanelSceneEntryModel {
	return {
		id,
		type: "user",
		text,
		chunks: [{ kind: "text", text }],
	};
}

function createNonIterableSceneEntries(
	entry: AgentPanelSceneEntryModel
): readonly AgentPanelSceneEntryModel[] {
	const entries: AgentPanelSceneEntryModel[] = [entry];
	Object.defineProperty(entries, Symbol.iterator, {
		value: () => {
			throw new Error("scene entries should not be fully iterated");
		},
	});
	return entries;
}

function createAccessCountingRows(rows: readonly TranscriptViewportRow[]): {
	readonly rows: readonly TranscriptViewportRow[];
	readIndexes(): readonly number[];
} {
	const readIndexes: number[] = [];
	const targetRows = rows.slice();
	Object.defineProperty(targetRows, Symbol.iterator, {
		value: () => {
			throw new Error("buffer rows should not be fully iterated");
		},
	});
	const proxyRows = new Proxy(targetRows, {
		get(target, property, receiver) {
			if (typeof property === "string" && /^\d+$/.test(property)) {
				readIndexes.push(Number(property));
			}
			return Reflect.get(target, property, receiver);
		},
	});
	return {
		rows: proxyRows,
		readIndexes: () => readIndexes.slice(),
	};
}

function createViewportUserRow(entryId: string, text: string): TranscriptViewportRow {
	return {
		rowId: entryId,
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
			segments: [{ kind: "text", segmentId: `${entryId}:segment:0`, text }],
		},
		durationStartedAtMs: null,
	};
}

function createHistoricalAssistantThoughtRow(entryId: string): TranscriptViewportRow {
	return {
		rowId: entryId,
		sourceEntryId: entryId,
		kind: "assistantThought",
		version: `${entryId}:v1`,
		anchorEligible: true,
		activeStreamingTail: null,
		operationLinks: [],
		interactionLinks: [],
		content: {
			kind: "transcript",
			role: "assistant",
			segments: [
				{
					kind: "thought",
					segmentId: `${entryId}:segment:0`,
					text: "Historical reasoning",
				},
			],
		},
		durationStartedAtMs: null,
	};
}

function createViewportToolRow(entryId: string): TranscriptViewportRow {
	return {
		rowId: entryId,
		sourceEntryId: entryId,
		kind: "tool",
		version: `${entryId}:v1`,
		anchorEligible: true,
		activeStreamingTail: null,
		operationLinks: [],
		interactionLinks: [],
		content: {
			kind: "transcript",
			role: "assistant",
			segments: [],
		},
		durationStartedAtMs: null,
	};
}

function createLinkedViewportToolRow(input: {
	readonly entryId: string;
	readonly operationId: string;
	readonly toolCallId: string;
	readonly operation?: OperationSnapshot;
}): TranscriptViewportRow {
	return {
		rowId: `transcript:${input.entryId}`,
		sourceEntryId: input.entryId,
		kind: "tool",
		version: `${input.entryId}:v1`,
		anchorEligible: true,
		activeStreamingTail: null,
		operationLinks: [
			{
				operationId: input.operationId,
				toolCallId: input.toolCallId,
				name: "exec_command",
				state: "completed",
				operation: input.operation ?? null,
			},
		],
		interactionLinks: [],
		content: {
			kind: "transcript",
			role: "tool",
			segments: [{ kind: "text", segmentId: `${input.entryId}:segment:0`, text: "exec_command" }],
		},
		durationStartedAtMs: null,
	};
}

function createViewportOperation(input: {
	readonly entryId: string;
	readonly operationId: string;
	readonly toolCallId: string;
}): OperationSnapshot {
	return {
		id: input.operationId,
		session_id: "session-compact",
		tool_call_id: input.toolCallId,
		name: "exec_command",
		kind: "execute",
		provider_status: "completed",
		title: "exec_command",
		arguments: { kind: "execute", command: "bun test" },
		progressive_arguments: null,
		result: { stdout: "ok", stderr: null, exitCode: 0 },
		computer_payload: null,
		command: "bun test",
		normalized_todos: null,
		parent_tool_call_id: null,
		parent_operation_id: null,
		child_tool_call_ids: [],
		child_operation_ids: [],
		operation_provenance_key: input.toolCallId,
		operation_state: "completed",
		locations: null,
		skill_meta: null,
		normalized_questions: null,
		question_answer: null,
		awaiting_plan_approval: false,
		plan_approval_request_id: null,
		started_at_ms: null,
		completed_at_ms: null,
		source_link: {
			kind: "transcript_linked",
			entry_id: input.entryId,
		},
		degradation_reason: null,
	};
}

function createCompactGraphWithOperations(
	operations: readonly OperationSnapshot[]
): AgentPanelCanonicalSource {
	return {
		canonicalSessionId: "session-compact",
		agentId: "codex",
		projectPath: "/repo",
		revision: {
			graphRevision: 1,
			transcriptRevision: 1,
			lastEventSeq: 1,
		},
		transcriptSnapshot: {
			revision: 1,
			entries: [],
		},
		operations: operations.slice(),
		interactions: [],
		turnState: "Completed",
		messageCount: 1,
		activeStreamingTail: null,
		lastTerminalTurnId: null,
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
		activity: {
			kind: "idle",
			activeOperationCount: 0,
			activeSubagentCount: 0,
			dominantOperationId: null,
			blockingInteractionId: null,
		},
	};
}

function createCompactGraph(operation: OperationSnapshot): AgentPanelCanonicalSource {
	return createCompactGraphWithOperations([operation]);
}

function createSyntheticReviewEntry(): AgentPanelSceneEntryModel {
	return {
		id: "local:review",
		type: "tool_call",
		kind: "review",
		title: "Edited files",
		status: "done",
		reviewFiles: [
			{
				id: "src/lib/alpha.ts",
				filePath: "src/lib/alpha.ts",
				fileName: "alpha.ts",
				additions: 12,
				deletions: 2,
			},
			{
				id: "src/lib/beta.ts",
				filePath: "src/lib/beta.ts",
				fileName: "beta.ts",
				additions: 3,
				deletions: 1,
			},
		],
	};
}

describe("buildRenderedTranscriptViewportRows", () => {
	it("builds cheap renderable rows before resolving visible rows", () => {
		const rows = buildRenderableTranscriptViewportRows({
			bufferRows: [createViewportUserRow("user-1", "Canonical message")],
			bufferStartIndex: 3,
			optimisticUserEntry: createOptimisticUserEntry("optimistic-user", "First message"),
			localPlaceholderMode: "connection",
		});

		expect(rows.map((row) => row.row.rowId)).toEqual([
			"user-1",
			"local:optimistic:optimistic-user",
			"awaiting:planning",
		]);
		expect(rows.map((row) => row.index)).toEqual([3, 4, 5]);
		expect(rows.map((row) => row.localOnly)).toEqual([false, true, true]);
		const first = rows[0];
		expect(first).toBeDefined();
		if (first === undefined) {
			return;
		}
		expect(first.key).toBe(`${first.row.rowId}:${first.row.version}`);
		expect(first.rowId).toBe("user-1");
		expect(first.estimatePx).toBeGreaterThan(0);
		expect(first.isActiveTail).toBe(false);
		expect(first.anchorEligible).toBe(true);
	});

	it("resolves a requested renderable row with local planning presentation", () => {
		const rows = buildRenderableTranscriptViewportRows({
			bufferRows: [],
			bufferStartIndex: 0,
			optimisticUserEntry: null,
			localPlaceholderMode: "connection",
		});
		const resolver = createRenderedTranscriptViewportRowResolver({
			optimisticUserEntry: null,
			planningPlaceholderPresentation: {
				label: "Planning",
				agentIconSrc: "/icons/test.svg",
				showWorkingSpark: true,
			},
		});
		const renderable = rows[0];
		expect(renderable).toBeDefined();
		if (renderable === undefined) {
			return;
		}
		const rendered = resolver(renderable);

		expect(rendered.entry).toMatchObject({
			id: "awaiting:planning",
			type: "thinking",
			label: "Planning",
			agentIconSrc: "/icons/test.svg",
			showWorkingSpark: true,
		});
	});

	it("keeps connection feedback after historical completed reasoning in eager and lazy rows", () => {
		const bufferRows = [
			createHistoricalAssistantThoughtRow("assistant-thought-1"),
			createViewportUserRow("user-1", "Reconnect this session"),
		];
		const presentation = {
			label: "Connecting to Codex Agent",
			agentIconSrc: "/icons/codex.svg",
			showWorkingSpark: false,
		};
		const eagerRows = buildRenderedTranscriptViewportRows({
			bufferRows,
			bufferStartIndex: 0,
			optimisticUserEntry: null,
			localPlaceholderMode: "connection",
			planningPlaceholderPresentation: presentation,
		});
		const lazySource = createRenderableTranscriptViewportRowSource({
			bufferRows,
			bufferStartIndex: 0,
			optimisticUserEntry: null,
			localPlaceholderMode: "connection",
		});
		const lazyResolver = createRenderedTranscriptViewportRowResolver({
			optimisticUserEntry: null,
			planningPlaceholderPresentation: presentation,
		});
		const lazyPlaceholder = lazySource.getRenderable(2);

		expect(eagerRows.at(-1)?.entry).toMatchObject({
			type: "thinking",
			label: "Connecting to Codex Agent",
		});
		expect(lazySource.length).toBe(3);
		expect(lazyPlaceholder).toBeDefined();
		if (lazyPlaceholder === undefined) {
			return;
		}
		expect(lazyResolver(lazyPlaceholder).entry).toMatchObject({
			type: "thinking",
			label: "Connecting to Codex Agent",
		});
	});

	it("keeps completed-tool planning eligibility identical in eager and lazy row sources", () => {
		const entryId = "acepe::entry::assistant-boundary:9902::tool::call_waiting";
		const operationId = "op:session-compact:call_waiting";
		const toolCallId = "call_waiting";
		const operation = createViewportOperation({ entryId, operationId, toolCallId });
		const bufferRows = [
			createLinkedViewportToolRow({ entryId, operationId, toolCallId, operation }),
		];
		const eagerRows = buildRenderableTranscriptViewportRows({
			bufferRows,
			bufferStartIndex: 0,
			optimisticUserEntry: null,
			localPlaceholderMode: "planning",
		});
		const lazySource = createRenderableTranscriptViewportRowSource({
			bufferRows,
			bufferStartIndex: 0,
			optimisticUserEntry: null,
			localPlaceholderMode: "planning",
		});

		expect(eagerRows.map((row) => row.rowId)).toEqual([
			`transcript:${entryId}`,
			"awaiting:planning",
		]);
		expect(lazySource.length).toBe(2);
		expect(lazySource.getRowId(0)).toBe(`transcript:${entryId}`);
		expect(lazySource.getRowId(1)).toBe("awaiting:planning");
		expect(lazySource.getRenderable(1)?.row).toMatchObject({
			kind: "localPlaceholder",
			mode: "planning",
		});
	});

	it("uses the UI planning fallback label after a tool while preserving agent visuals", () => {
		const entryId = "acepe::entry::assistant-boundary:9903::tool::call_label";
		const operationId = "op:session-compact:call_label";
		const toolCallId = "call_label";
		const operation = createViewportOperation({ entryId, operationId, toolCallId });
		const rows = buildRenderedTranscriptViewportRows({
			bufferRows: [createLinkedViewportToolRow({ entryId, operationId, toolCallId, operation })],
			bufferStartIndex: 0,
			optimisticUserEntry: null,
			localPlaceholderMode: "planning",
			planningPlaceholderPresentation: {
				label: "Connecting to Codex Agent",
				agentIconSrc: "/icons/codex.svg",
				showWorkingSpark: true,
			},
		});

		expect(rows.at(-1)?.entry).toMatchObject({
			type: "thinking",
			label: null,
			agentIconSrc: "/icons/codex.svg",
			showWorkingSpark: true,
		});
	});

	it("does not inspect scene entries when resolving persisted viewport rows", () => {
		const rows = buildRenderedTranscriptViewportRows({
			bufferRows: [createViewportUserRow("user-1", "Canonical message")],
			bufferStartIndex: 0,
			optimisticUserEntry: null,
			localPlaceholderMode: "none",
		});

		expect(rows).toHaveLength(1);
		expect(rows[0]?.entry).toMatchObject({
			id: "user-1",
			type: "user",
			text: "Canonical message",
		});
	});

	it("adds local-only optimistic and planning rows before Rust has viewport rows", () => {
		const sentAtMs = Date.UTC(2026, 6, 17, 0, 56, 39);
		const rows = buildRenderedTranscriptViewportRows({
			bufferRows: [],
			bufferStartIndex: 0,
			optimisticUserEntry: createOptimisticUserEntry("optimistic-user", "First message", sentAtMs),
			localPlaceholderMode: "connection",
		});

		expect(rows.map((row) => row.entry.type)).toEqual(["user", "thinking"]);
		expect(rows.every((row) => row.localOnly)).toBe(true);
		expect(rows[0]?.entry).toMatchObject({
			id: "optimistic-user",
			type: "user",
			text: "First message",
			isOptimistic: true,
			timestampMs: sentAtMs,
		});
		expect(rows[1]?.row.kind).toBe("localPlaceholder");
		expect(rows[1]?.row.rowId).toBe("awaiting:planning");
		expect(rows[1]?.row.sourceEntryId).toBe("awaiting:planning");
		expect(rows[1]?.row.version).toBe("00000000000000000000000000000000");
	});

	it("does not duplicate a scene entry already represented by a Rust viewport row", () => {
		const rows = buildRenderedTranscriptViewportRows({
			bufferRows: [createViewportUserRow("user-1", "Canonical message")],
			bufferStartIndex: 3,
			optimisticUserEntry: createOptimisticUserEntry("user-1", "Canonical message"),
			localPlaceholderMode: "none",
		});

		expect(rows).toHaveLength(1);
		expect(rows[0]?.localOnly).toBe(false);
		expect(rows[0]?.entry.type).toBe("user");
	});

	it("appends a local-only synthetic review row after canonical rows", () => {
		const rows = buildRenderedTranscriptViewportRows({
			bufferRows: [createViewportUserRow("user-1", "Canonical message")],
			bufferStartIndex: 3,
			optimisticUserEntry: null,
			localPlaceholderMode: "none",
			syntheticReviewEntry: createSyntheticReviewEntry(),
		});

		expect(rows).toHaveLength(2);
		expect(rows[0]?.localOnly).toBe(false);
		expect(rows[1]?.localOnly).toBe(true);
		expect(rows[1]?.row.rowId).toBe("local:review");
		expect(rows[1]?.row.kind).toBe("tool");
		const reviewRow = rows[1]?.row;
		if (reviewRow === undefined || reviewRow.kind === "localPlaceholder") {
			throw new Error("expected a local review transcript row");
		}
		expect(reviewRow.operationLinks).toEqual([]);
		expect(rows[1]?.entry).toMatchObject({
			id: "local:review",
			type: "tool_call",
			kind: "review",
			title: "Edited files",
			status: "done",
		});
	});

	it("removes the synthetic review row as soon as an optimistic user send is appended", () => {
		const rows = buildRenderedTranscriptViewportRows({
			bufferRows: [createViewportUserRow("user-1", "Previous message")],
			bufferStartIndex: 3,
			optimisticUserEntry: createOptimisticUserEntry("pending-user", "hi"),
			localPlaceholderMode: "none",
			syntheticReviewEntry: createSyntheticReviewEntry(),
		});

		expect(rows.map((row) => row.row.rowId)).toEqual(["user-1", "local:optimistic:pending-user"]);
	});

	it("does not append the synthetic review row after a local planning placeholder", () => {
		const rows = buildRenderedTranscriptViewportRows({
			bufferRows: [createViewportUserRow("user-1", "Previous message")],
			bufferStartIndex: 3,
			optimisticUserEntry: null,
			localPlaceholderMode: "planning",
			syntheticReviewEntry: createSyntheticReviewEntry(),
		});

		expect(rows.map((row) => row.row.rowId)).toEqual(["user-1", "awaiting:planning"]);
	});

	it("does not append a synthetic review row when the caller omits it", () => {
		const rows = buildRenderedTranscriptViewportRows({
			bufferRows: [createViewportUserRow("user-1", "Canonical message")],
			bufferStartIndex: 3,
			optimisticUserEntry: null,
			localPlaceholderMode: "none",
			syntheticReviewEntry: null,
		});

		expect(rows).toHaveLength(1);
		expect(rows[0]?.row.rowId).toBe("user-1");
	});

	it("does not duplicate a synthetic review entry already represented by a Rust viewport row", () => {
		const rows = buildRenderedTranscriptViewportRows({
			bufferRows: [createViewportToolRow("local:review")],
			bufferStartIndex: 3,
			optimisticUserEntry: null,
			localPlaceholderMode: "none",
			syntheticReviewEntry: createSyntheticReviewEntry(),
		});

		expect(rows).toHaveLength(1);
		expect(rows[0]?.row.rowId).toBe("local:review");
		expect(rows[0]?.localOnly).toBe(false);
	});

	it("keeps large row sources lazy until the visible window is requested", () => {
		const fixture = createAgentPanelStressFixture({
			rowCount: 100_000,
			preset: "mixed",
			seed: 42,
			sessionId: "large-source-session",
		});
		const counted = createAccessCountingRows(fixture.rowsProjection.rows);
		const source = createRenderableTranscriptViewportRowSource({
			bufferRows: counted.rows,
			bufferStartIndex: 0,
			optimisticUserEntry: null,
			localPlaceholderMode: "none",
			syntheticReviewEntry: null,
		});

		expect(source.length).toBe(100_000);
		expect(counted.readIndexes()).toEqual([]);

		const firstExpectedRow = fixture.rowsProjection.rows[0];
		const lastExpectedRow = fixture.rowsProjection.rows[99_999];
		if (firstExpectedRow === undefined || lastExpectedRow === undefined) {
			return;
		}

		expect(source.getKey(0)).toBe(renderKey(firstExpectedRow));
		expect(source.getKey(99_999)).toBe(renderKey(lastExpectedRow));

		const visibleItems = source.getItems(50_000, 50_020);
		const firstVisibleExpectedRow = fixture.rowsProjection.rows[50_000];
		const lastVisibleExpectedRow = fixture.rowsProjection.rows[50_019];
		if (firstVisibleExpectedRow === undefined || lastVisibleExpectedRow === undefined) {
			return;
		}

		expect(visibleItems).toHaveLength(20);
		expect(visibleItems[0]?.rowId).toBe(firstVisibleExpectedRow.rowId);
		expect(visibleItems[19]?.rowId).toBe(lastVisibleExpectedRow.rowId);
		expect(counted.readIndexes().length).toBeLessThanOrEqual(22);
	});

	it("does not fall back to a second operation store when viewport facts are missing", () => {
		const entryId = "acepe::entry::assistant-boundary:9821::tool::call_tool";
		const operationId = "op:session-compact:call_tool";
		const toolCallId = "call_tool";
		const rows = buildRenderedTranscriptViewportRows({
			bufferRows: [createLinkedViewportToolRow({ entryId, operationId, toolCallId })],
			bufferStartIndex: 0,
			optimisticUserEntry: null,
			localPlaceholderMode: "none",
		});

		expect(rows[0]?.entry).toMatchObject({
			id: entryId,
			type: "missing",
			title: "Unavailable transcript row",
		});
	});

	it("resolves visible tool rows from embedded viewport operations after operation-list compaction", () => {
		const entryId = "acepe::entry::assistant-boundary:9901::tool::call_embedded";
		const operationId = "op:session-compact:call_embedded";
		const toolCallId = "call_embedded";
		const operation = createViewportOperation({ entryId, operationId, toolCallId });
		const rows = buildRenderedTranscriptViewportRows({
			bufferRows: [createLinkedViewportToolRow({ entryId, operationId, toolCallId, operation })],
			bufferStartIndex: 0,
			optimisticUserEntry: null,
			localPlaceholderMode: "none",
		});

		expect(rows[0]?.entry).toMatchObject({
			id: entryId,
			type: "tool_call",
			toolCallId,
			operationId,
			kind: "execute",
			title: "Run",
			command: "bun test",
			stdout: '{"stdout":"ok","stderr":null,"exitCode":0}',
			status: "done",
			presentationState: "resolved",
		});
	});
});
