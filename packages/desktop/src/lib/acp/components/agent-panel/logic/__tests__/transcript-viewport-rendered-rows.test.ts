import { describe, expect, it } from "bun:test";
import type { AgentPanelSceneEntryModel } from "@acepe/ui/agent-panel";
import type {
	OperationSnapshot,
	TranscriptViewportRow,
} from "../../../../../services/acp-types.js";
import { createAgentPanelStressFixture } from "../../../../testing/agent-panel-stress-fixture.js";
import { renderKey } from "../../../../store/transcript-rows-store.js";
import type { AgentPanelCanonicalSource } from "../../../../session-state/agent-panel-canonical-source.js";
import { createViewportOperationSceneEntryResolver } from "../../../../session-state/viewport-operation-scene-entry-resolver.js";
import {
	buildRenderableTranscriptViewportRows,
	buildRenderedTranscriptViewportRows,
	createRenderableTranscriptViewportRowSource,
	createRenderedTranscriptViewportRowResolver,
} from "../transcript-viewport-rendered-rows.js";

function createOptimisticUserEntry(id: string, text: string): AgentPanelSceneEntryModel {
	return {
		id,
		type: "user",
		text,
		isOptimistic: true,
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
			sceneEntries: [
				createCanonicalUserEntry("user-1", "Canonical message"),
				createOptimisticUserEntry("optimistic-user", "First message"),
			],
			showLocalPlanningIndicator: true,
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
		expect(first.key).toBe(renderKey(first.row));
		expect(first.rowId).toBe("user-1");
		expect(first.estimatePx).toBeGreaterThan(0);
		expect(first.isActiveTail).toBe(false);
		expect(first.anchorEligible).toBe(true);
	});

	it("resolves a requested renderable row with local planning presentation", () => {
		const rows = buildRenderableTranscriptViewportRows({
			bufferRows: [],
			bufferStartIndex: 0,
			sceneEntries: [],
			showLocalPlanningIndicator: true,
		});
		const resolver = createRenderedTranscriptViewportRowResolver({
			sceneEntries: [],
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

	it("resolves aligned scene entries without iterating the full scene list", () => {
		const rows = buildRenderedTranscriptViewportRows({
			bufferRows: [createViewportUserRow("user-1", "Canonical message")],
			bufferStartIndex: 0,
			sceneEntries: createNonIterableSceneEntries(
				createCanonicalUserEntry("user-1", "Canonical message")
			),
			showLocalPlanningIndicator: false,
		});

		expect(rows).toHaveLength(1);
		expect(rows[0]?.entry).toMatchObject({
			id: "user-1",
			type: "user",
			text: "Canonical message",
		});
	});

	it("adds local-only optimistic and planning rows before Rust has viewport rows", () => {
		const rows = buildRenderedTranscriptViewportRows({
			bufferRows: [],
			bufferStartIndex: 0,
			sceneEntries: [createOptimisticUserEntry("optimistic-user", "First message")],
			showLocalPlanningIndicator: true,
		});

		expect(rows.map((row) => row.entry.type)).toEqual(["user", "thinking"]);
		expect(rows.every((row) => row.localOnly)).toBe(true);
		expect(rows[0]?.entry).toMatchObject({
			id: "optimistic-user",
			type: "user",
			text: "First message",
			isOptimistic: true,
		});
		expect(rows[1]?.row.kind).toBe("awaitingPlaceholder");
		expect(rows[1]?.row.rowId).toBe("awaiting:planning");
		expect(rows[1]?.row.sourceEntryId).toBe("awaiting:planning");
		expect(rows[1]?.row.version).toBe("00000000000000000000000000000000");
	});

	it("does not duplicate a scene entry already represented by a Rust viewport row", () => {
		const rows = buildRenderedTranscriptViewportRows({
			bufferRows: [createViewportUserRow("user-1", "Canonical message")],
			bufferStartIndex: 3,
			sceneEntries: [createOptimisticUserEntry("user-1", "Canonical message")],
			showLocalPlanningIndicator: false,
		});

		expect(rows).toHaveLength(1);
		expect(rows[0]?.localOnly).toBe(false);
		expect(rows[0]?.entry.type).toBe("user");
	});

	it("appends a local-only synthetic review row after canonical rows", () => {
		const rows = buildRenderedTranscriptViewportRows({
			bufferRows: [createViewportUserRow("user-1", "Canonical message")],
			bufferStartIndex: 3,
			sceneEntries: [],
			showLocalPlanningIndicator: false,
			syntheticReviewEntry: createSyntheticReviewEntry(),
		});

		expect(rows).toHaveLength(2);
		expect(rows[0]?.localOnly).toBe(false);
		expect(rows[1]?.localOnly).toBe(true);
		expect(rows[1]?.row.rowId).toBe("local:review");
		expect(rows[1]?.row.kind).toBe("tool");
		expect(rows[1]?.row.operationLinks).toEqual([]);
		expect(rows[1]?.entry).toMatchObject({
			id: "local:review",
			type: "tool_call",
			kind: "review",
			title: "Edited files",
			status: "done",
		});
	});

	it("does not append a synthetic review row when the caller omits it", () => {
		const rows = buildRenderedTranscriptViewportRows({
			bufferRows: [createViewportUserRow("user-1", "Canonical message")],
			bufferStartIndex: 3,
			sceneEntries: [],
			showLocalPlanningIndicator: false,
			syntheticReviewEntry: null,
		});

		expect(rows).toHaveLength(1);
		expect(rows[0]?.row.rowId).toBe("user-1");
	});

	it("does not duplicate a synthetic review entry already represented by a Rust viewport row", () => {
		const rows = buildRenderedTranscriptViewportRows({
			bufferRows: [createViewportToolRow("local:review")],
			bufferStartIndex: 3,
			sceneEntries: [createSyntheticReviewEntry()],
			showLocalPlanningIndicator: false,
			syntheticReviewEntry: createSyntheticReviewEntry(),
		});

		expect(rows).toHaveLength(1);
		expect(rows[0]?.row.rowId).toBe("local:review");
		expect(rows[0]?.localOnly).toBe(false);
	});
});
