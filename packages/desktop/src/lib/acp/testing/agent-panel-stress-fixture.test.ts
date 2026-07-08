import { describe, expect, it } from "vitest";
import { buildRenderedTranscriptViewportRows } from "../components/agent-panel/logic/transcript-viewport-rendered-rows.js";
import {
	AGENT_PANEL_STRESS_ROW_COUNT_PRESETS,
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
			sceneEntries: fixture.sceneEntries,
			showLocalPlanningIndicator: false,
			planningPlaceholderPresentation: null,
			syntheticReviewEntry: null,
		});

		expect(renderedRows).toHaveLength(160);
		expect(renderedRows.every((row) => row.localOnly === false)).toBe(true);
		expect(renderedRows.every((row) => row.entry.type !== "missing")).toBe(true);
	});
});
