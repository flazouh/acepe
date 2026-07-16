import { describe, expect, it } from "vitest";
import { buildRenderedTranscriptViewportRows } from "../components/agent-panel/logic/transcript-viewport-rendered-rows.js";
import {
	AGENT_PANEL_STRESS_ROW_COUNT_PRESETS,
	createAgentPanelPlanningBetweenToolsFixtureSequence,
	createAgentPanelSendAttachFixtureSequence,
	createAgentPanelStressFixture,
	type AgentPanelStressPreset,
} from "./agent-panel-stress-fixture.js";

function activeTailCount(rows: ReturnType<typeof createAgentPanelStressFixture>["rowsProjection"]["rows"]): number {
	let count = 0;
	for (const row of rows) {
		if (row.activeStreamingTail !== null) {
			count += 1;
		}
	}
	return count;
}

function uniqueCount(values: readonly string[]): number {
	return new Set(values).size;
}

describe("createAgentPanelStressFixture", () => {
	it("builds the provider-free planning-between-tools transition", () => {
		const sequence = createAgentPanelPlanningBetweenToolsFixtureSequence();

		expect(sequence.completedToolTail.rowsProjection.rows.map((row) => row.kind)).toEqual([
			"user",
			"tool",
		]);
		expect(sequence.completedToolTail.rowsProjection.rows.at(-1)?.operationLinks).toMatchObject([
			{ state: "completed" },
		]);
		expect(sequence.activeAssistantTail.rowsProjection.rows.map((row) => row.kind)).toEqual([
			"user",
			"tool",
			"assistantText",
		]);
		expect(sequence.activeAssistantTail.rowsProjection.rows.at(-1)?.activeStreamingTail).toBe(
			"message"
		);
		expect(sequence.activeAssistantTail.rowsProjection.rows.slice(0, 2)).toEqual(
			sequence.completedToolTail.rowsProjection.rows
		);
	});

	it("builds the provider-free send attach sequence with one stable streaming row", () => {
		const sequence = createAgentPanelSendAttachFixtureSequence({ rowCount: 120 });

		expect(sequence.initial.rowsProjection.rows).toHaveLength(120);
		expect(sequence.initial.rowsProjection.rows.length).toBeLessThan(200);
		expect(sequence.pendingUser.rowsProjection.rows).toHaveLength(121);
		expect(sequence.firstStream.rowsProjection.rows).toHaveLength(122);
		expect(sequence.updatedStream.rowsProjection.rows).toHaveLength(122);

		const longEntry = sequence.initial.sceneEntries.find(
			(entry) => entry.id === sequence.longMarkdownEntryId
		);
		expect(longEntry?.type).toBe("assistant");
		if (longEntry?.type !== "assistant") {
			throw new Error("Send attach fixture did not create its long assistant row");
		}
		expect(longEntry.markdown).toContain("send-attach-long-markdown-end");

		const pendingRow = sequence.pendingUser.rowsProjection.rows.at(-1);
		expect(pendingRow?.rowId).toBe(sequence.pendingUserRowId);
		expect(pendingRow?.kind).toBe("user");

		const firstStreamRow = sequence.firstStream.rowsProjection.byId.get(
			sequence.streamingRowId
		);
		const updatedStreamRow = sequence.updatedStream.rowsProjection.byId.get(
			sequence.streamingRowId
		);
		expect(firstStreamRow?.version).toBe(`${sequence.streamingRowId}:v1`);
		expect(updatedStreamRow?.version).toBe(`${sequence.streamingRowId}:v2`);
		expect(firstStreamRow?.rowId).toBe(updatedStreamRow?.rowId);
		expect(firstStreamRow?.content).not.toEqual(updatedStreamRow?.content);
		expect(updatedStreamRow?.activeStreamingTail).toBe("message");
	});

	it("generates stable matching scene entries and viewport rows", () => {
		const first = createAgentPanelStressFixture({
			rowCount: 1_000,
			preset: "mixed",
			seed: 7,
			sessionId: "stress-session",
		});
		const second = createAgentPanelStressFixture({
			rowCount: 1_000,
			preset: "mixed",
			seed: 7,
			sessionId: "stress-session",
		});

		expect(first.rowsProjection.rows).toHaveLength(1_000);
		expect(first.sceneEntries).toHaveLength(1_000);
		expect(first.rowsProjection.order).toHaveLength(1_000);
		expect(first.rowsProjection.byId.size).toBe(1_000);
		expect(first.rowsProjection.sessionId).toBe("stress-session");
		expect(first.rowsProjection.rows[0]?.rowId).toBe(second.rowsProjection.rows[0]?.rowId);
		expect(first.rowsProjection.rows[999]?.rowId).toBe(second.rowsProjection.rows[999]?.rowId);
	});

	it("exposes the required large row count presets", () => {
		expect(AGENT_PANEL_STRESS_ROW_COUNT_PRESETS).toEqual([1_000, 5_000, 10_000, 25_000]);
	});

	it.each([
		["text-heavy", "assistantText", "tool"],
		["tool-heavy", "tool", "assistantText"],
	] as const)(
		"uses the expected %s distribution",
		(preset: AgentPanelStressPreset, dominantKind, secondaryKind) => {
			const fixture = createAgentPanelStressFixture({
				rowCount: 120,
				preset,
				seed: 1,
				sessionId: "stress-session",
			});

			expect(fixture.summary.kindCounts[dominantKind]).toBeGreaterThan(
				fixture.summary.kindCounts[secondaryKind]
			);
		}
	);

	it("returns an empty projection for zero rows", () => {
		const fixture = createAgentPanelStressFixture({
			rowCount: 0,
			preset: "mixed",
			seed: 1,
			sessionId: "empty-session",
		});

		expect(fixture.sceneEntries).toEqual([]);
		expect(fixture.rowsProjection.rows).toEqual([]);
		expect(fixture.rowsProjection.order).toEqual([]);
		expect(fixture.rowsProjection.byId.size).toBe(0);
		expect(fixture.summary.totalRows).toBe(0);
	});

	it("keeps 25k row fixtures as plain arrays with unique row ids", () => {
		const fixture = createAgentPanelStressFixture({
			rowCount: 25_000,
			preset: "streaming-tail",
			seed: 3,
			sessionId: "large-session",
		});

		expect(Array.isArray(fixture.sceneEntries)).toBe(true);
		expect(Array.isArray(fixture.rowsProjection.rows)).toBe(true);
		expect(Array.isArray(fixture.rowsProjection.order)).toBe(true);
		expect(fixture.rowsProjection.rows).toHaveLength(25_000);
		expect(uniqueCount(fixture.rowsProjection.order)).toBe(25_000);
		expect(activeTailCount(fixture.rowsProjection.rows)).toBe(1);
		expect(fixture.summary.activeTailRowId).toBe(fixture.rowsProjection.rows[24_999]?.rowId);
	});

	it("passes through rendered row construction without missing-entry fallbacks", () => {
		const fixture = createAgentPanelStressFixture({
			rowCount: 160,
			preset: "mixed",
			seed: 11,
			sessionId: "render-session",
		});

		const renderedRows = buildRenderedTranscriptViewportRows({
			bufferRows: fixture.rowsProjection.rows,
			bufferStartIndex: 0,
			optimisticUserEntry: null,
			localPlaceholderMode: "none",
			planningPlaceholderPresentation: null,
			syntheticReviewEntry: null,
		});

		expect(renderedRows).toHaveLength(160);
		expect(renderedRows.every((row) => row.localOnly === false)).toBe(true);
		expect(renderedRows.every((row) => row.entry.type !== "missing")).toBe(true);
	});
});
