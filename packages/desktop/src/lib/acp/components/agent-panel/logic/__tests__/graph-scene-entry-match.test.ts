import type { AgentPanelSceneEntryModel } from "@acepe/ui/agent-panel";
import { describe, expect, it } from "vitest";
import type { SessionEntry } from "../../../../application/dto/session-entry.js";
import {
	createGraphSceneEntryIndex,
	createGraphSceneEntryIndexReadModel,
	findGraphSceneEntryForDisplayEntry,
} from "../graph-scene-entry-match.js";
import { buildVirtualizedDisplayEntries } from "../virtualized-entry-display.js";

function createAssistantDisplayEntry(id: string, text: string): SessionEntry {
	return {
		id,
		type: "assistant",
		message: {
			chunks: [
				{
					type: "message",
					block: {
						type: "text",
						text,
					},
				},
			],
		},
	};
}

function createToolDisplayEntry(id: string): SessionEntry {
	return {
		id,
		type: "tool_call",
		message: {
			id,
			name: "execute",
			kind: "execute",
			status: "in_progress",
			title: "placeholder",
			arguments: { kind: "execute", command: "" },
			result: null,
			awaitingPlanApproval: false,
		},
	};
}

describe("findGraphSceneEntryForDisplayEntry", () => {
	it("selects a graph scene tool entry when it matches the displayed transcript row", () => {
		const sceneEntry: AgentPanelSceneEntryModel = {
			id: "tool-1",
			type: "tool_call",
			kind: "execute",
			title: "Run canonical command",
			status: "done",
			command: "ls",
			stdout: "README.md",
			presentationState: "resolved",
		};

		expect(
			findGraphSceneEntryForDisplayEntry(
				createToolDisplayEntry("tool-1"),
				createGraphSceneEntryIndex([sceneEntry])
			)
		).toBe(sceneEntry);
	});

	it("rejects graph scene entries that do not match the displayed row key", () => {
		const sceneEntry: AgentPanelSceneEntryModel = {
			id: "other-tool",
			type: "tool_call",
			kind: "execute",
			title: "Wrong row",
			status: "done",
		};

		expect(
			findGraphSceneEntryForDisplayEntry(
				createToolDisplayEntry("tool-1"),
				createGraphSceneEntryIndex([sceneEntry])
			)
		).toBeUndefined();
	});

	it("selects by row id when assistant merging shifts display indexes", () => {
		const sceneEntry: AgentPanelSceneEntryModel = {
			id: "tool-1",
			type: "tool_call",
			kind: "execute",
			title: "Run canonical command",
			status: "done",
			command: "bun test",
			stdout: "ok",
			presentationState: "resolved",
		};
		const displayEntries = buildVirtualizedDisplayEntries([
			createAssistantDisplayEntry("assistant-1", "First chunk"),
			createAssistantDisplayEntry("assistant-2", "Second chunk"),
			createToolDisplayEntry("tool-1"),
		]);

		expect(displayEntries[0]?.type).toBe("assistant_merged");
		expect(
			findGraphSceneEntryForDisplayEntry(
				displayEntries[1],
				createGraphSceneEntryIndex([
					{
						id: "assistant-1",
						type: "assistant",
						markdown: "First chunk",
					},
					{
						id: "assistant-2",
						type: "assistant",
						markdown: "Second chunk",
					},
					sceneEntry,
				])
			)
		).toBe(sceneEntry);
	});

	it("matches first-class missing display rows by scene id without transcript fallback", () => {
		const sceneEntry: AgentPanelSceneEntryModel = {
			id: "missing-1",
			type: "missing",
			diagnosticLabel: "missing-1",
		};

		expect(
			findGraphSceneEntryForDisplayEntry(
				{
					id: "missing-1",
					type: "missing",
				},
				createGraphSceneEntryIndex([sceneEntry])
			)
		).toBe(sceneEntry);
	});
});

describe("createGraphSceneEntryIndexReadModel", () => {
	it("exposes snapshot, append patch, and select index operations", () => {
		const readModel = createGraphSceneEntryIndexReadModel();
		const firstEntry: AgentPanelSceneEntryModel = {
			id: "tool-1",
			type: "tool_call",
			title: "Run first command",
			status: "done",
		};
		const nextEntry: AgentPanelSceneEntryModel = {
			id: "tool-2",
			type: "tool_call",
			title: "Run second command",
			status: "pending",
		};

		const snapshotIndex = readModel.applySnapshot([firstEntry]);
		const patchedIndex = readModel.applyAppendPatch([nextEntry]);

		expect(patchedIndex).toBe(snapshotIndex);
		expect(readModel.selectIndex()).toBe(patchedIndex);
		expect(patchedIndex.get("tool-1")).toBe(firstEntry);
		expect(patchedIndex.get("tool-2")).toBe(nextEntry);
		expect(readModel.selectEntryById("tool-2")).toBe(nextEntry);
		expect(readModel.selectEntryById(null)).toBeUndefined();
	});

	it("keeps the selected index stable for empty append patches", () => {
		const readModel = createGraphSceneEntryIndexReadModel();
		const entry: AgentPanelSceneEntryModel = {
			id: "tool-1",
			type: "tool_call",
			title: "Run command",
			status: "done",
		};
		const snapshotIndex = readModel.applySnapshot([entry]);

		expect(readModel.applyAppendPatch([])).toBe(snapshotIndex);
		expect(readModel.selectIndex()).toBe(snapshotIndex);
	});

	it("uses append-only updates when prior scene entries keep their identity", () => {
		const readModel = createGraphSceneEntryIndexReadModel();
		const firstEntry: AgentPanelSceneEntryModel = {
			id: "tool-1",
			type: "tool_call",
			title: "Run first command",
			status: "done",
		};
		const nextEntry: AgentPanelSceneEntryModel = {
			id: "tool-2",
			type: "tool_call",
			title: "Run second command",
			status: "pending",
		};
		const firstIndex = readModel.getIndex([firstEntry]);

		const nextIndex = readModel.getIndex([firstEntry, nextEntry]);

		expect(nextIndex).toBe(firstIndex);
		expect(nextIndex.get("tool-1")).toBe(firstEntry);
		expect(nextIndex.get("tool-2")).toBe(nextEntry);
	});

	it("uses append-only updates when prior scene entries are fresh but content-stable", () => {
		const readModel = createGraphSceneEntryIndexReadModel();
		const firstIndex = readModel.getIndex([
			{
				id: "user-1",
				type: "user",
				text: "Prompt",
				timestampMs: 1,
			},
		]);
		const nextAssistantEntry: AgentPanelSceneEntryModel = {
			id: "assistant-1",
			type: "assistant",
			markdown: "Answer",
			timestampMs: 2,
		};

		const nextIndex = readModel.getIndex([
			{
				id: "user-1",
				type: "user",
				text: "Prompt",
				timestampMs: 1,
			},
			nextAssistantEntry,
		]);

		expect(nextIndex).toBe(firstIndex);
		expect(nextIndex.get("user-1")).toMatchObject({ id: "user-1", type: "user" });
		expect(nextIndex.get("assistant-1")).toBe(nextAssistantEntry);
	});

	it("rebuilds the index when an existing scene entry object changes", () => {
		const readModel = createGraphSceneEntryIndexReadModel();
		const firstEntry: AgentPanelSceneEntryModel = {
			id: "tool-1",
			type: "tool_call",
			title: "Run first command",
			status: "pending",
		};
		const changedEntry: AgentPanelSceneEntryModel = {
			id: "tool-1",
			type: "tool_call",
			title: "Run changed command",
			status: "done",
		};
		const firstIndex = readModel.getIndex([firstEntry]);

		const nextIndex = readModel.getIndex([changedEntry]);

		expect(nextIndex).not.toBe(firstIndex);
		expect(nextIndex.get("tool-1")).toBe(changedEntry);
	});
});
