import type { AgentPanelSceneEntryModel } from "@acepe/ui/agent-panel";
import { describe, expect, it } from "vitest";

import { createGraphSceneEntryIndexReadModel } from "../../../../session-state/graph-scene-entry-index.js";
import {
	scenePatchDisplayScene,
	scenePatchFullRebuild,
	scenePatchGraphScene,
	scenePatchGraphSceneAppend,
	scenePatchIdentity,
	scenePatchStableIncremental,
} from "../scene-patch.js";
import { buildRevealScenePatchedEntriesWithPatch } from "../reveal-scene-patch.js";

describe("applyWithScenePatch", () => {
	it("routes graph scene patches to the same index result as stable incremental inference", () => {
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
		const baseEntries = [firstEntry];
		const firstIndex = readModel.applySnapshot(baseEntries);

		const explicitIndex = readModel.applyWithScenePatch(
			[changedEntry],
			scenePatchGraphScene({
				baseSceneEntries: baseEntries,
				entries: [changedEntry],
				entriesByIndex: new Map([[0, changedEntry]]),
			})
		);

		expect(explicitIndex).toBe(firstIndex);
		expect(explicitIndex.get("tool-1")).toBe(changedEntry);
	});

	it("routes display scene patches without rebuilding indexes", () => {
		const readModel = createGraphSceneEntryIndexReadModel();
		const assistantEntry = {
			id: "assistant-1",
			type: "assistant",
			markdown: "",
			isStreaming: true,
		} satisfies AgentPanelSceneEntryModel;
		const baseEntries = [assistantEntry];
		const baseIndex = readModel.applySnapshot(baseEntries);
		const revealResult = buildRevealScenePatchedEntriesWithPatch(
			baseEntries,
			new Map([
				[0, { id: "assistant-1", type: "assistant", markdown: "Answer", isStreaming: true }],
			])
		);

		const patchedIndex = readModel.applyWithScenePatch(
			revealResult.entries,
			revealResult.scenePatch
		);

		expect(patchedIndex).not.toBe(baseIndex);
		expect(patchedIndex.get("assistant-1")).toMatchObject({
			id: "assistant-1",
			markdown: "Answer",
		});
	});

	it("performs a deterministic full rebuild for the fullRebuild variant", () => {
		const readModel = createGraphSceneEntryIndexReadModel();
		const firstEntry: AgentPanelSceneEntryModel = {
			id: "tool-1",
			type: "tool_call",
			title: "Run first command",
			status: "done",
		};
		const secondEntry: AgentPanelSceneEntryModel = {
			id: "tool-2",
			type: "tool_call",
			title: "Run second command",
			status: "pending",
		};
		const firstIndex = readModel.applySnapshot([firstEntry]);
		const rebuiltIndex = readModel.applyWithScenePatch([secondEntry], scenePatchFullRebuild());

		expect(rebuiltIndex).not.toBe(firstIndex);
		expect(rebuiltIndex.get("tool-2")).toBe(secondEntry);
		expect(rebuiltIndex.has("tool-1")).toBe(false);
	});

	it("keeps the selected index stable for identity patches", () => {
		const readModel = createGraphSceneEntryIndexReadModel();
		const entry: AgentPanelSceneEntryModel = {
			id: "tool-1",
			type: "tool_call",
			title: "Run command",
			status: "done",
		};
		const entries = [entry];
		const snapshotIndex = readModel.applySnapshot(entries);
		const identityIndex = readModel.applyWithScenePatch(entries, scenePatchIdentity());

		expect(identityIndex).toBe(snapshotIndex);
	});

	it("routes append patches over a prior snapshot", () => {
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
		const baseEntries = [firstEntry];
		const firstIndex = readModel.applySnapshot(baseEntries);
		const nextEntries = [firstEntry, nextEntry];
		const appendedIndex = readModel.applyWithScenePatch(
			nextEntries,
			scenePatchGraphSceneAppend({
				baseSceneEntries: baseEntries,
				appendedEntries: [nextEntry],
			})
		);

		expect(appendedIndex).toBe(firstIndex);
		expect(appendedIndex.get("tool-2")).toBe(nextEntry);
	});

	it("rebuilds when a producer patch is applied to the wrong entry generation", () => {
		const readModel = createGraphSceneEntryIndexReadModel();
		const baseEntry = {
			id: "assistant-1",
			type: "assistant",
			markdown: "First",
		} satisfies AgentPanelSceneEntryModel;
		const nextEntry = {
			id: "assistant-2",
			type: "assistant",
			markdown: "Second",
		} satisfies AgentPanelSceneEntryModel;
		const currentEntries = [baseEntry, nextEntry];

		readModel.applyWithScenePatch([baseEntry], scenePatchStableIncremental());
		const staleMaterializerPatch = scenePatchGraphSceneAppend({
			baseSceneEntries: [],
			appendedEntries: [nextEntry],
		});
		const rebuiltIndex = readModel.applyWithScenePatch(
			currentEntries,
			staleMaterializerPatch
		);

		expect(rebuiltIndex.get("assistant-1")).toEqual(baseEntry);
		expect(rebuiltIndex.get("assistant-2")).toEqual(nextEntry);
	});

	it("uses fullRebuild when producers are deliberately reordered", () => {
		const readModel = createGraphSceneEntryIndexReadModel();
		const entry = {
			id: "assistant-1",
			type: "assistant",
			markdown: "Answer",
		} satisfies AgentPanelSceneEntryModel;
		readModel.applyWithScenePatch([entry], scenePatchStableIncremental());
		const rebuiltIndex = readModel.applyWithScenePatch([entry], scenePatchFullRebuild());
		expect(rebuiltIndex.get("assistant-1")).toEqual(entry);
	});
});
