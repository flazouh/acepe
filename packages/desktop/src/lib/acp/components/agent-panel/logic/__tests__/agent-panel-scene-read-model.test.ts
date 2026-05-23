import type { AgentPanelSceneEntryModel } from "@acepe/ui/agent-panel";
import { describe, expect, it } from "vitest";

import { createAgentPanelSceneReadModel } from "../agent-panel-scene-read-model.js";
import { getSceneDisplayRowKey, THINKING_DISPLAY_ENTRY } from "../scene-display-rows.js";

describe("createAgentPanelSceneReadModel", () => {
	it("exposes rows and graph entries from one scene snapshot", () => {
		const readModel = createAgentPanelSceneReadModel();
		const userEntry: AgentPanelSceneEntryModel = {
			id: "user-1",
			type: "user",
			text: "Prompt",
			timestampMs: 10,
		};
		const assistantEntry: AgentPanelSceneEntryModel = {
			id: "assistant-1",
			type: "assistant",
			markdown: "Answer",
			timestampMs: 20,
		};
		const entries = [userEntry, assistantEntry];

		const snapshot = readModel.applySnapshot(entries);

		expect(snapshot.rows.map((row) => getSceneDisplayRowKey(row))).toEqual([
			"user-1",
			"assistant-1",
		]);
		expect(snapshot.latestRowTimestampMs).toBe(20);
		expect(snapshot.entriesById.get("user-1")).toBe(userEntry);
		expect(snapshot.entriesById.get("assistant-1")).toBe(assistantEntry);
		expect(readModel.selectGraphEntryForDisplayEntry(snapshot.rows[0])).toBe(userEntry);
		expect(readModel.selectGraphEntryForDisplayEntry(snapshot.rows[1])).toBeUndefined();
		expect(readModel.selectGraphEntryForDisplayEntry(THINKING_DISPLAY_ENTRY)).toBeUndefined();
		expect(readModel.selectSnapshot()).toBe(snapshot);
		expect(readModel.applySnapshot(entries)).toBe(snapshot);
	});

	it("applies append patches to rows and graph entry index together", () => {
		const readModel = createAgentPanelSceneReadModel();
		const userEntry: AgentPanelSceneEntryModel = {
			id: "user-1",
			type: "user",
			text: "Prompt",
		};
		const assistantEntry: AgentPanelSceneEntryModel = {
			id: "assistant-1",
			type: "assistant",
			markdown: "First",
		};
		const nextAssistantEntry: AgentPanelSceneEntryModel = {
			id: "assistant-2",
			type: "assistant",
			markdown: "Second",
			timestampMs: 30,
		};
		const toolEntry: AgentPanelSceneEntryModel = {
			id: "tool-1",
			type: "tool_call",
			title: "Run",
			status: "done",
		};
		const firstSnapshot = readModel.applySnapshot([userEntry, assistantEntry]);

		const patchedSnapshot = readModel.applyAppendPatch([nextAssistantEntry, toolEntry]);

		expect(patchedSnapshot.rows[0]).toBe(firstSnapshot.rows[0]);
		expect(patchedSnapshot.latestRowTimestampMs).toBe(30);
		expect(patchedSnapshot.rows.map((row) => getSceneDisplayRowKey(row))).toEqual([
			"user-1",
			"assistant-1",
			"tool-1",
		]);
		expect(patchedSnapshot.entriesById).toBe(firstSnapshot.entriesById);
		expect(patchedSnapshot.entriesById.get("assistant-2")).toBe(nextAssistantEntry);
		expect(patchedSnapshot.entriesById.get("tool-1")).toBe(toolEntry);
		expect(readModel.selectGraphEntryForDisplayEntry(patchedSnapshot.rows[0])).toBe(userEntry);
		expect(readModel.selectGraphEntryForDisplayEntry(patchedSnapshot.rows[1])).toBeUndefined();
		expect(readModel.selectGraphEntryForDisplayEntry(patchedSnapshot.rows[2])).toBe(toolEntry);
		expect(readModel.selectSnapshot()).toBe(patchedSnapshot);
		expect(readModel.applyAppendPatch([])).toBe(patchedSnapshot);
	});

	it("applies stable tail truncation without rebuilding preserved rows or index maps", () => {
		const readModel = createAgentPanelSceneReadModel();
		const userEntry: AgentPanelSceneEntryModel = {
			id: "user-1",
			type: "user",
			text: "Prompt",
			timestampMs: 10,
		};
		const toolEntry: AgentPanelSceneEntryModel = {
			id: "tool-1",
			type: "tool_call",
			title: "Run",
			status: "done",
		};
		const interactionEntry: AgentPanelSceneEntryModel = {
			id: "interaction:question-1",
			type: "tool_call",
			interactionId: "question-1",
			title: "Question",
			status: "running",
		};
		const firstSnapshot = readModel.applySnapshot([userEntry, toolEntry, interactionEntry]);

		const truncatedSnapshot = readModel.applySnapshot([userEntry, toolEntry]);

		expect(truncatedSnapshot.rows).toHaveLength(2);
		expect(truncatedSnapshot.rows[0]).toBe(firstSnapshot.rows[0]);
		expect(truncatedSnapshot.rows[1]).toBe(firstSnapshot.rows[1]);
		expect(truncatedSnapshot.latestRowTimestampMs).toBe(10);
		expect(truncatedSnapshot.entriesById).toBe(firstSnapshot.entriesById);
		expect(truncatedSnapshot.entriesById.has("interaction:question-1")).toBe(false);
		expect(truncatedSnapshot.entriesById.get("tool-1")).toBe(toolEntry);
		expect(readModel.selectGraphEntryForDisplayEntry(truncatedSnapshot.rows[1])).toBe(
			toolEntry
		);
	});

	it("applies stable tail truncation without copying preserved rows", () => {
		const readModel = createAgentPanelSceneReadModel();
		const userEntry: AgentPanelSceneEntryModel = {
			id: "user-1",
			type: "user",
			text: "Prompt",
		};
		const toolEntry: AgentPanelSceneEntryModel = {
			id: "tool-1",
			type: "tool_call",
			title: "Run",
			status: "done",
		};
		const pendingEntry: AgentPanelSceneEntryModel = {
			id: "interaction:question-1",
			type: "tool_call",
			interactionId: "question-1",
			title: "Question",
			status: "running",
		};
		const firstSnapshot = readModel.applySnapshot([userEntry, toolEntry, pendingEntry]);
		const originalSlice = firstSnapshot.rows.slice;

		firstSnapshot.rows.slice = () => {
			throw new Error("must not copy preserved rows for stable truncation");
		};

		try {
			const truncatedSnapshot = readModel.applySnapshot([userEntry, toolEntry]);

			expect(truncatedSnapshot.rows).toHaveLength(2);
			expect(truncatedSnapshot.rows[0]).toBe(firstSnapshot.rows[0]);
			expect(truncatedSnapshot.rows[1]).toBe(firstSnapshot.rows[1]);
			expect(truncatedSnapshot.rows.map((row) => getSceneDisplayRowKey(row))).toEqual([
				"user-1",
				"tool-1",
			]);
		} finally {
			firstSnapshot.rows.slice = originalSlice;
		}
	});

	it("patches one graph entry without rebuilding the graph entry index", () => {
		const readModel = createAgentPanelSceneReadModel();
		const userEntry: AgentPanelSceneEntryModel = {
			id: "user-1",
			type: "user",
			text: "Prompt",
		};
		const toolEntry: AgentPanelSceneEntryModel = {
			id: "tool-1",
			type: "tool_call",
			title: "Run",
			status: "running",
		};
		const firstSnapshot = readModel.applySnapshot([userEntry, toolEntry]);
		const nextToolEntry: AgentPanelSceneEntryModel = {
			...toolEntry,
			status: "done",
		};

		const patchedSnapshot = readModel.applySnapshot([userEntry, nextToolEntry]);

		expect(patchedSnapshot.entriesById).toBe(firstSnapshot.entriesById);
		expect(patchedSnapshot.entriesById.get("user-1")).toBe(userEntry);
		expect(patchedSnapshot.entriesById.get("tool-1")).toBe(nextToolEntry);
		expect(patchedSnapshot.rows[0]).toBe(firstSnapshot.rows[0]);
		expect(readModel.selectGraphEntryForDisplayEntry(patchedSnapshot.rows[1])).toBe(
			nextToolEntry
		);
	});

	it("patches stable transcript insertion before a pending interaction", () => {
		const readModel = createAgentPanelSceneReadModel();
		const userEntry: AgentPanelSceneEntryModel = {
			id: "user-1",
			type: "user",
			text: "Prompt",
			timestampMs: 10,
		};
		const interactionEntry: AgentPanelSceneEntryModel = {
			id: "interaction:question-1",
			type: "tool_call",
			interactionId: "question-1",
			title: "Question",
			status: "running",
		};
		const assistantEntry: AgentPanelSceneEntryModel = {
			id: "assistant-1",
			type: "assistant",
			markdown: "Answer",
			timestampMs: 20,
		};
		const firstSnapshot = readModel.applySnapshot([userEntry, interactionEntry]);

		const patchedSnapshot = readModel.applySnapshot([
			userEntry,
			assistantEntry,
			interactionEntry,
		]);

		expect(patchedSnapshot.rows.map((row) => getSceneDisplayRowKey(row))).toEqual([
			"user-1",
			"assistant-1",
			"interaction:question-1",
		]);
		expect(patchedSnapshot.rows[0]).toBe(firstSnapshot.rows[0]);
		expect(patchedSnapshot.rows[2]).toBe(firstSnapshot.rows[1]);
		expect(patchedSnapshot.entriesById).toBe(firstSnapshot.entriesById);
		expect(patchedSnapshot.entriesById.get("assistant-1")).toBe(assistantEntry);
		expect(patchedSnapshot.entriesById.get("interaction:question-1")).toBe(interactionEntry);
		expect(readModel.selectGraphEntryForDisplayEntry(patchedSnapshot.rows[2])).toBe(
			interactionEntry
		);
	});

	it("patches stable transcript insertion without copying existing display rows", () => {
		const readModel = createAgentPanelSceneReadModel();
		const userEntry: AgentPanelSceneEntryModel = {
			id: "user-1",
			type: "user",
			text: "Prompt",
			timestampMs: 10,
		};
		const toolEntry: AgentPanelSceneEntryModel = {
			id: "tool-1",
			type: "tool_call",
			title: "Run",
			status: "done",
		};
		const nextToolEntry: AgentPanelSceneEntryModel = {
			id: "tool-2",
			type: "tool_call",
			title: "Check",
			status: "done",
		};
		const firstSnapshot = readModel.applySnapshot([userEntry, nextToolEntry]);
		const originalSlice = firstSnapshot.rows.slice;

		firstSnapshot.rows.slice = () => {
			throw new Error("must not copy existing display rows for stable insertion");
		};

		try {
			const patchedSnapshot = readModel.applySnapshot([userEntry, toolEntry, nextToolEntry]);

			expect(patchedSnapshot.rows[0]).toBe(firstSnapshot.rows[0]);
			expect(patchedSnapshot.rows[1]).toMatchObject({ id: "tool-1" });
			expect(patchedSnapshot.rows[2]).toBe(firstSnapshot.rows[1]);
			expect(patchedSnapshot.rows.map((row) => getSceneDisplayRowKey(row))).toEqual([
				"user-1",
				"tool-1",
				"tool-2",
			]);
		} finally {
			firstSnapshot.rows.slice = originalSlice;
		}
	});
});
