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
		};
		const assistantEntry: AgentPanelSceneEntryModel = {
			id: "assistant-1",
			type: "assistant",
			markdown: "Answer",
		};

		const entries = [userEntry, assistantEntry];

		const snapshot = readModel.applySnapshot(entries);

		expect(snapshot.rows.map((row) => getSceneDisplayRowKey(row))).toEqual([
			"user-1",
			"assistant-1",
		]);
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
});
