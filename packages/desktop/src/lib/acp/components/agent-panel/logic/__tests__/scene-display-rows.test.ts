import { describe, expect, it } from "bun:test";
import type { AgentPanelSceneEntryModel } from "@acepe/ui/agent-panel";
import {
	appendSceneDisplayRows,
	buildSceneDisplayRows,
	getSceneDisplayRowKey,
	getSceneDisplayRowTimestampMs,
	resolveSceneDisplayRowThinkingDurationMs,
	THINKING_DISPLAY_ENTRY,
} from "../scene-display-rows.js";
import { createSceneDisplayRowsReadModel } from "../scene-display-row-read-model.js";

describe("scene-display-rows", () => {
	it("builds stable scene-derived display rows for mixed conversation entries", () => {
		const rows = buildSceneDisplayRows([
			{ id: "user-1", type: "user", text: "Prompt" },
			{ id: "assistant-1", type: "assistant", markdown: "First" },
			{ id: "assistant-2", type: "assistant", markdown: "Second" },
			{ id: "tool-1", type: "tool_call", title: "Run", status: "done" },
			{ id: "missing-1", type: "missing", diagnosticLabel: "missing-1" },
		]);

		expect(rows.map((row) => getSceneDisplayRowKey(row))).toEqual([
			"user-1",
			"assistant-1",
			"tool-1",
			"missing-1",
		]);
		expect(rows[1]?.type).toBe("assistant_merged");
		if (rows[1]?.type === "assistant_merged") {
			expect(rows[1].memberIds).toEqual(["assistant-1", "assistant-2"]);
			expect(rows[1].markdown).toBe("FirstSecond");
		}
	});

	it("keeps destructive scene row replacements visible in ordered display keys", () => {
		const initial: AgentPanelSceneEntryModel[] = [
			{ id: "user-1", type: "user", text: "Prompt" },
			{ id: "assistant-1", type: "assistant", markdown: "First" },
			{ id: "user-2", type: "user", text: "Next" },
		];
		const replacement: AgentPanelSceneEntryModel[] = [
			{ id: "user-1", type: "user", text: "Prompt" },
			{ id: "user-2", type: "user", text: "Next" },
			{ id: "assistant-2", type: "assistant", markdown: "Replacement" },
		];

		const initialKeys = buildSceneDisplayRows(initial).map((row) => getSceneDisplayRowKey(row));
		const replacementKeys = buildSceneDisplayRows(replacement).map((row) =>
			getSceneDisplayRowKey(row)
		);

		expect(initialKeys).toEqual(["user-1", "assistant-1", "user-2"]);
		expect(replacementKeys).toEqual(["user-1", "user-2", "assistant-2"]);
		expect(replacementKeys.slice(0, initialKeys.length)).not.toEqual(initialKeys);
	});

	it("derives thinking durations from scene timestamps", () => {
		const startedAtMs = Date.parse("2026-05-01T00:00:00.000Z");
		const rows = buildSceneDisplayRows([
			{
				id: "assistant-1",
				type: "assistant",
				markdown: "Thinking result",
				timestampMs: startedAtMs,
			},
		]);
		const displayRows = rows.concat([
			{
				id: THINKING_DISPLAY_ENTRY.id,
				type: THINKING_DISPLAY_ENTRY.type,
				startedAtMs,
			},
		]);

		expect(getSceneDisplayRowTimestampMs(rows[0]!)).toBe(startedAtMs);
		expect(resolveSceneDisplayRowThinkingDurationMs(displayRows, 1, startedAtMs + 3_000)).toBe(
			3_000
		);
	});

	it("preserves rich assistant thought chunks for completed scene durations", () => {
		const startedAtMs = Date.parse("2026-05-01T00:00:00.000Z");
		const nextTimestampMs = startedAtMs + 5_000;
		const rows = buildSceneDisplayRows([
			{
				id: "assistant-1",
				type: "assistant",
				markdown: "Thinking result",
				timestampMs: startedAtMs,
				message: {
					chunks: [{ type: "thought", block: { type: "text", text: "Checking" } }],
				},
			},
			{ id: "user-2", type: "user", text: "Next", timestampMs: nextTimestampMs },
		]);

		expect(resolveSceneDisplayRowThinkingDurationMs(rows, 0, startedAtMs + 30_000)).toBe(5_000);
	});

	it("appends scene rows without rebuilding the unchanged prefix", () => {
		const firstUser = {
			id: "user-1",
			type: "user",
			text: "Prompt",
		} satisfies AgentPanelSceneEntryModel;
		const firstAssistant = {
			id: "assistant-1",
			type: "assistant",
			markdown: "First",
		} satisfies AgentPanelSceneEntryModel;
		const nextAssistant = {
			id: "assistant-2",
			type: "assistant",
			markdown: "Second",
		} satisfies AgentPanelSceneEntryModel;
		const initialRows = buildSceneDisplayRows([firstUser, firstAssistant]);

		const rows = appendSceneDisplayRows(initialRows, [nextAssistant]);

		expect(rows[0]).toBe(initialRows[0]);
		expect(rows.map((row) => getSceneDisplayRowKey(row))).toEqual(["user-1", "assistant-1"]);
		expect(rows[1]?.type).toBe("assistant_merged");
		if (rows[1]?.type === "assistant_merged") {
			expect(rows[1].memberIds).toEqual(["assistant-1", "assistant-2"]);
			expect(rows[1].markdown).toBe("FirstSecond");
		}
	});

	it("memoizes display rows for identical scene entry arrays", () => {
		const readModel = createSceneDisplayRowsReadModel();
		const entries: readonly AgentPanelSceneEntryModel[] = [
			{ id: "user-1", type: "user", text: "Prompt" },
			{ id: "assistant-1", type: "assistant", markdown: "Answer" },
		];

		const firstRows = readModel.getRows(entries);
		const secondRows = readModel.getRows(entries);

		expect(secondRows).toBe(firstRows);
	});

	it("uses append-only updates when prior scene entries keep their identity", () => {
		const readModel = createSceneDisplayRowsReadModel();
		const firstUser = {
			id: "user-1",
			type: "user",
			text: "Prompt",
		} satisfies AgentPanelSceneEntryModel;
		const firstAssistant = {
			id: "assistant-1",
			type: "assistant",
			markdown: "First",
		} satisfies AgentPanelSceneEntryModel;
		const nextAssistant = {
			id: "assistant-2",
			type: "assistant",
			markdown: "Second",
		} satisfies AgentPanelSceneEntryModel;
		const firstRows = readModel.getRows([firstUser, firstAssistant]);

		const nextRows = readModel.getRows([firstUser, firstAssistant, nextAssistant]);

		expect(nextRows[0]).toBe(firstRows[0]);
		expect(nextRows.map((row) => getSceneDisplayRowKey(row))).toEqual(["user-1", "assistant-1"]);
		expect(nextRows[1]?.type).toBe("assistant_merged");
		if (nextRows[1]?.type === "assistant_merged") {
			expect(nextRows[1].markdown).toBe("FirstSecond");
		}
	});

	it("rebuilds rows when the scene is replaced instead of appended", () => {
		const readModel = createSceneDisplayRowsReadModel();
		const firstRows = readModel.getRows([
			{ id: "user-1", type: "user", text: "Prompt" },
			{ id: "assistant-1", type: "assistant", markdown: "First" },
		]);

		const replacementRows = readModel.getRows([
			{ id: "user-1", type: "user", text: "Prompt" },
			{ id: "assistant-2", type: "assistant", markdown: "Replacement" },
		]);

		expect(replacementRows).not.toBe(firstRows);
		expect(replacementRows.map((row) => getSceneDisplayRowKey(row))).toEqual([
			"user-1",
			"assistant-2",
		]);
	});
});
