import type { AgentPanelSceneEntryModel } from "@acepe/ui/agent-panel";
import { describe, expect, it } from "vitest";
import type { SessionEntry } from "../../../../application/dto/session.js";
import {
	createGraphSceneEntryIndex,
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
