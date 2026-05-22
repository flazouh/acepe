import type { AgentPanelSceneEntryModel } from "@acepe/ui/agent-panel";
import { describe, expect, it } from "vitest";

import { createAgentPanelSceneReadModel } from "../agent-panel-scene-read-model.js";
import { getSceneDisplayRowKey } from "../scene-display-rows.js";

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
		const firstSnapshot = readModel.applySnapshot([userEntry, assistantEntry]);

		const patchedSnapshot = readModel.applyAppendPatch([nextAssistantEntry]);

		expect(patchedSnapshot.rows[0]).toBe(firstSnapshot.rows[0]);
		expect(patchedSnapshot.rows.map((row) => getSceneDisplayRowKey(row))).toEqual([
			"user-1",
			"assistant-1",
		]);
		expect(patchedSnapshot.entriesById).toBe(firstSnapshot.entriesById);
		expect(patchedSnapshot.entriesById.get("assistant-2")).toBe(nextAssistantEntry);
		expect(readModel.selectSnapshot()).toBe(patchedSnapshot);
		expect(readModel.applyAppendPatch([])).toBe(patchedSnapshot);
	});
});
