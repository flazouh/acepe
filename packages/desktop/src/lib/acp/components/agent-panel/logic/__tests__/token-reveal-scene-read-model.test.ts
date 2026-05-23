import type { AgentPanelSceneEntryModel, TokenRevealCss } from "@acepe/ui/agent-panel";
import { describe, expect, it } from "vitest";
import {
	markAgentPanelSceneEntryArrayAppendPatch,
	markAgentPanelSceneEntryArrayPatch,
	markAgentPanelSceneEntryArrayTruncation,
} from "../../../../session-state/agent-panel-scene-entry-array-patch.js";
import {
	applyAgentPanelDisplayModelToSceneEntries,
	createAgentPanelDisplayMemory,
	type AgentPanelDisplayModel,
} from "../agent-panel-display-model.js";
import {
	createTokenRevealSceneReadModel,
	getTokenRevealScenePatch,
} from "../token-reveal-scene-read-model.js";

function createTokenRevealCss(): TokenRevealCss {
	return {
		revealCount: 2,
		revealedCharCount: 12,
		baselineMs: 100,
		tokStepMs: 20,
		tokFadeDurMs: 80,
		mode: "smooth",
	};
}

describe("createTokenRevealSceneReadModel", () => {
	it("returns the original scene entries when there is no token reveal row", () => {
		const readModel = createTokenRevealSceneReadModel();
		const entries: readonly AgentPanelSceneEntryModel[] = [
			{ id: "user-1", type: "user", text: "Prompt" },
		];

		const selectedEntries = readModel.applySnapshot({
			sceneEntries: entries,
			sourceEntry: undefined,
			tailRowId: null,
			tokenRevealCss: undefined,
		});

		expect(selectedEntries).toBe(entries);
		expect(readModel.selectEntries()).toBe(entries);
		expect(readModel.selectSettlingTimings()).toEqual([]);
	});

	it("copies only the matching assistant row when token reveal css exists", () => {
		const readModel = createTokenRevealSceneReadModel();
		const userEntry: AgentPanelSceneEntryModel = {
			id: "user-1",
			type: "user",
			text: "Prompt",
		};
		const assistantEntry: AgentPanelSceneEntryModel = {
			id: "assistant-1",
			type: "assistant",
			markdown: "display text",
			isStreaming: false,
		};
		const sourceAssistantEntry: AgentPanelSceneEntryModel = {
			id: "assistant-1",
			type: "assistant",
			markdown: "source text",
			message: { chunks: [{ type: "message", block: { type: "text", text: "source text" } }] },
			isStreaming: false,
		};
		const tokenRevealCss = createTokenRevealCss();

		const selectedEntries = readModel.applySnapshot({
			sceneEntries: [userEntry, assistantEntry],
			sourceEntry: sourceAssistantEntry,
			tailRowId: "assistant-1",
			tokenRevealCss,
		});

		expect(selectedEntries[0]).toBe(userEntry);
		expect(selectedEntries[1]).not.toBe(assistantEntry);
		expect(selectedEntries[1]).toMatchObject({
			id: "assistant-1",
			type: "assistant",
			markdown: "source text",
			tokenRevealCss,
		});
		expect(readModel.selectSettlingTimings()).toEqual([
			{
				revealCount: tokenRevealCss.revealCount,
				baselineMs: tokenRevealCss.baselineMs,
				tokStepMs: tokenRevealCss.tokStepMs,
				tokFadeDurMs: tokenRevealCss.tokFadeDurMs,
				mode: tokenRevealCss.mode,
			},
		]);
	});

	it("overlays the reveal row without slicing the whole scene array", () => {
		const readModel = createTokenRevealSceneReadModel();
		const userEntry: AgentPanelSceneEntryModel = {
			id: "user-1",
			type: "user",
			text: "Prompt",
		};
		const assistantEntry: AgentPanelSceneEntryModel = {
			id: "assistant-1",
			type: "assistant",
			markdown: "Answer",
			isStreaming: true,
		};
		const sceneEntries = [userEntry, assistantEntry];
		const originalSlice = sceneEntries.slice;
		const tokenRevealCss = createTokenRevealCss();

		sceneEntries.slice = () => {
			throw new Error("must not slice whole scene entries");
		};

		try {
			const selectedEntries = readModel.applySnapshot({
				sceneEntries,
				sourceEntry: assistantEntry,
				tailRowId: "assistant-1",
				tokenRevealCss,
			});

			expect(Array.isArray(selectedEntries)).toBe(true);
			expect(selectedEntries.length).toBe(2);
			expect(selectedEntries[0]).toBe(userEntry);
			expect(selectedEntries[1]).not.toBe(assistantEntry);
			expect(selectedEntries[1]).toMatchObject({
				id: "assistant-1",
				tokenRevealCss,
			});
			expect([...selectedEntries][0]).toBe(userEntry);
			expect([...selectedEntries][1]).toMatchObject({
				id: "assistant-1",
				tokenRevealCss,
			});
			expect(selectedEntries.slice()[1]).toMatchObject({
				id: "assistant-1",
				tokenRevealCss,
			});
			expect(selectedEntries.at(1)).toMatchObject({
				id: "assistant-1",
				tokenRevealCss,
			});
		} finally {
			sceneEntries.slice = originalSlice;
		}
	});

	it("memoizes identical snapshots", () => {
		const readModel = createTokenRevealSceneReadModel();
		const assistantEntry: AgentPanelSceneEntryModel = {
			id: "assistant-1",
			type: "assistant",
			markdown: "Answer",
			isStreaming: true,
		};
		const tokenRevealCss = createTokenRevealCss();
		const snapshot = {
			sceneEntries: [assistantEntry],
			sourceEntry: assistantEntry,
			tailRowId: "assistant-1",
			tokenRevealCss,
		};

		const firstEntries = readModel.applySnapshot(snapshot);
		const secondEntries = readModel.applySnapshot(snapshot);

		expect(secondEntries).toBe(firstEntries);
		expect(readModel.selectSettlingTimings()).toEqual([]);
	});

	it("keeps stable no-op scene updates on the patch lane", () => {
		const readModel = createTokenRevealSceneReadModel();
		const assistantEntry: AgentPanelSceneEntryModel = {
			id: "assistant-1",
			type: "assistant",
			markdown: "Answer",
			isStreaming: true,
		};
		const toolEntry: AgentPanelSceneEntryModel = {
			id: "tool-1",
			type: "tool_call",
			kind: "execute",
			title: "Read file",
			status: "done",
		};
		const tokenRevealCss = createTokenRevealCss();
		const firstEntries = readModel.applySnapshot({
			sceneEntries: [assistantEntry, toolEntry],
			sourceEntry: assistantEntry,
			tailRowId: "assistant-1",
			tailRowIndex: 0,
			tokenRevealCss,
		});

		const patchedEntries = readModel.applyPatch({
			sceneEntries: [{ ...assistantEntry }, { ...toolEntry }],
			sourceEntry: assistantEntry,
			tailRowId: "assistant-1",
			tailRowIndex: 0,
			tokenRevealCss,
		});

		expect(patchedEntries).toBe(firstEntries);
	});

	it("keeps selecting the same tail row when token reveal css changes", () => {
		const readModel = createTokenRevealSceneReadModel();
		const userEntry: AgentPanelSceneEntryModel = {
			id: "user-1",
			type: "user",
			text: "Prompt",
		};
		const assistantEntry: AgentPanelSceneEntryModel = {
			id: "assistant-1",
			type: "assistant",
			markdown: "Answer",
			isStreaming: true,
		};
		const firstCss = createTokenRevealCss();
		const nextCss: TokenRevealCss = {
			...firstCss,
			revealCount: firstCss.revealCount + 1,
		};

		const firstEntries = readModel.applySnapshot({
			sceneEntries: [userEntry, assistantEntry],
			sourceEntry: assistantEntry,
			tailRowId: "assistant-1",
			tokenRevealCss: firstCss,
		});
		const nextEntries = readModel.applySnapshot({
			sceneEntries: [userEntry, assistantEntry],
			sourceEntry: assistantEntry,
			tailRowId: "assistant-1",
			tokenRevealCss: nextCss,
		});

		expect(firstEntries[0]).toBe(userEntry);
		expect(nextEntries[0]).toBe(userEntry);
		expect(firstEntries[1]).toMatchObject({ id: "assistant-1", tokenRevealCss: firstCss });
		expect(nextEntries[1]).toMatchObject({ id: "assistant-1", tokenRevealCss: nextCss });
	});

	it("uses the supplied tail row index before scanning for the reveal row", () => {
		const readModel = createTokenRevealSceneReadModel();
		const earlierAssistantEntry: AgentPanelSceneEntryModel = {
			id: "assistant-earlier",
			type: "assistant",
			markdown: "Earlier",
		};
		const tailAssistantEntry: AgentPanelSceneEntryModel = {
			id: "assistant-tail",
			type: "assistant",
			markdown: "Tail",
			isStreaming: true,
		};
		const tokenRevealCss = createTokenRevealCss();

		const selectedEntries = readModel.applySnapshot({
			sceneEntries: [earlierAssistantEntry, tailAssistantEntry],
			sourceEntry: tailAssistantEntry,
			tailRowId: "assistant-tail",
			tailRowIndex: 1,
			tokenRevealCss,
		});

		expect(selectedEntries[0]).toBe(earlierAssistantEntry);
		expect(selectedEntries[1]).not.toBe(tailAssistantEntry);
		expect(selectedEntries[1]).toMatchObject({
			id: "assistant-tail",
			tokenRevealCss,
		});
	});

	it("describes both assistant row changes when the reveal tail moves", () => {
		const readModel = createTokenRevealSceneReadModel();
		const firstAssistantEntry: AgentPanelSceneEntryModel = {
			id: "assistant-1",
			type: "assistant",
			markdown: "First",
			isStreaming: true,
		};
		const secondAssistantEntry: AgentPanelSceneEntryModel = {
			id: "assistant-2",
			type: "assistant",
			markdown: "Second",
			isStreaming: true,
		};
		const tokenRevealCss = createTokenRevealCss();
		const baseEntries = [firstAssistantEntry, secondAssistantEntry];

		readModel.applySnapshot({
			sceneEntries: baseEntries,
			sourceEntry: firstAssistantEntry,
			tailRowId: "assistant-1",
			tailRowIndex: 0,
			tokenRevealCss,
		});

		const movedEntries = readModel.applySnapshot({
			sceneEntries: baseEntries,
			sourceEntry: secondAssistantEntry,
			tailRowId: "assistant-2",
			tailRowIndex: 1,
			tokenRevealCss,
		});

		const patch = getTokenRevealScenePatch(movedEntries);
		expect(patch?.baseSceneEntries).toBe(baseEntries);
		expect(patch?.entries).toHaveLength(2);
		expect(patch?.entries[0]).toMatchObject({ id: "assistant-2", tokenRevealCss });
		expect(patch?.entries[1]).toBe(firstAssistantEntry);
		expect(movedEntries[0]).toBe(firstAssistantEntry);
		expect(movedEntries[1]).not.toBe(secondAssistantEntry);
		expect(movedEntries[1]).toMatchObject({ id: "assistant-2", tokenRevealCss });
	});

	it("applies append patches without rebuilding the existing reveal overlay", () => {
		const readModel = createTokenRevealSceneReadModel();
		const assistantEntry: AgentPanelSceneEntryModel = {
			id: "assistant-1",
			type: "assistant",
			markdown: "Answer",
			isStreaming: true,
		};
		const toolEntry: AgentPanelSceneEntryModel = {
			id: "tool-1",
			type: "tool_call",
			kind: "execute",
			title: "Read file",
			status: "done",
		};
		const tokenRevealCss = createTokenRevealCss();
		const baseEntries = [assistantEntry];

		const firstEntries = readModel.applySnapshot({
			sceneEntries: baseEntries,
			sourceEntry: assistantEntry,
			tailRowId: "assistant-1",
			tailRowIndex: 0,
			tokenRevealCss,
		});
		const appendedEntries = [...baseEntries, toolEntry];
		markAgentPanelSceneEntryArrayAppendPatch(appendedEntries, {
			baseSceneEntries: baseEntries,
			appendedEntries: [toolEntry],
		});

		const patchedEntries = readModel.applyPatch({
			sceneEntries: appendedEntries,
			sourceEntry: assistantEntry,
			tailRowId: "assistant-1",
			tailRowIndex: 0,
			tokenRevealCss,
		});

		expect(patchedEntries).not.toBeNull();
		expect(patchedEntries?.[0]).toBe(firstEntries[0]);
		expect(patchedEntries?.[1]).toBe(toolEntry);
	});

	it("keeps stable append updates on the patch lane", () => {
		const readModel = createTokenRevealSceneReadModel();
		const assistantEntry: AgentPanelSceneEntryModel = {
			id: "assistant-1",
			type: "assistant",
			markdown: "Answer",
			isStreaming: true,
		};
		const toolEntry: AgentPanelSceneEntryModel = {
			id: "tool-1",
			type: "tool_call",
			kind: "execute",
			title: "Read file",
			status: "done",
		};
		const tokenRevealCss = createTokenRevealCss();
		const baseEntries = [assistantEntry];

		const firstEntries = readModel.applySnapshot({
			sceneEntries: baseEntries,
			sourceEntry: assistantEntry,
			tailRowId: "assistant-1",
			tailRowIndex: 0,
			tokenRevealCss,
		});

		const patchedEntries = readModel.applyPatch({
			sceneEntries: [assistantEntry, toolEntry],
			sourceEntry: assistantEntry,
			tailRowId: "assistant-1",
			tailRowIndex: 0,
			tokenRevealCss,
		});

		expect(patchedEntries).not.toBeNull();
		expect(patchedEntries?.[0]).toBe(firstEntries[0]);
		expect(patchedEntries?.[1]).toBe(toolEntry);
	});

	it("applies unrelated graph patches over the existing reveal overlay", () => {
		const readModel = createTokenRevealSceneReadModel();
		const assistantEntry: AgentPanelSceneEntryModel = {
			id: "assistant-1",
			type: "assistant",
			markdown: "Answer",
			isStreaming: true,
		};
		const toolEntry: AgentPanelSceneEntryModel = {
			id: "tool-1",
			type: "tool_call",
			kind: "execute",
			title: "Read file",
			status: "running",
		};
		const patchedToolEntry: AgentPanelSceneEntryModel = {
			...toolEntry,
			status: "done",
		};
		const tokenRevealCss = createTokenRevealCss();
		const baseEntries = [assistantEntry, toolEntry];

		const firstEntries = readModel.applySnapshot({
			sceneEntries: baseEntries,
			sourceEntry: assistantEntry,
			tailRowId: "assistant-1",
			tailRowIndex: 0,
			tokenRevealCss,
		});
		const patchedBaseEntries = [assistantEntry, patchedToolEntry];
		const entriesByIndex = new Map<number, AgentPanelSceneEntryModel>([[1, patchedToolEntry]]);
		markAgentPanelSceneEntryArrayPatch(patchedBaseEntries, {
			baseSceneEntries: baseEntries,
			entries: [patchedToolEntry],
			entriesByIndex,
		});

		const patchedEntries = readModel.applyPatch({
			sceneEntries: patchedBaseEntries,
			sourceEntry: assistantEntry,
			tailRowId: "assistant-1",
			tailRowIndex: 0,
			tokenRevealCss,
		});

		expect(patchedEntries).not.toBeNull();
		expect(patchedEntries?.[0]).toBe(firstEntries[0]);
		expect(patchedEntries?.[1]).toBe(patchedToolEntry);
	});

	it("applies unrelated display patches over the existing reveal overlay", () => {
		const readModel = createTokenRevealSceneReadModel();
		const revealAssistantEntry: AgentPanelSceneEntryModel = {
			id: "assistant-1",
			type: "assistant",
			markdown: "Answer",
			isStreaming: true,
		};
		const otherAssistantEntry: AgentPanelSceneEntryModel = {
			id: "assistant-2",
			type: "assistant",
			markdown: "Original",
			isStreaming: false,
		};
		const tokenRevealCss = createTokenRevealCss();
		const baseEntries = [revealAssistantEntry, otherAssistantEntry];

		const firstEntries = readModel.applySnapshot({
			sceneEntries: baseEntries,
			sourceEntry: revealAssistantEntry,
			tailRowId: "assistant-1",
			tailRowIndex: 0,
			tokenRevealCss,
		});

		const displayModel: AgentPanelDisplayModel = {
			panelId: "panel-1",
			sessionId: "session-1",
			turnId: "turn-1",
			status: "running",
			turnState: "streaming",
			waiting: { show: false, label: null },
			composer: { canSubmit: false, showStop: true },
			rows: [
				{
					id: "assistant-1",
					type: "assistant",
					canonicalText: "Answer",
					displayText: "Answer",
					canonicalTextRevision: "1:assistant-1",
					isLiveTail: true,
				},
				{
					id: "assistant-2",
					type: "assistant",
					canonicalText: "Original",
					displayText: "Display override",
					canonicalTextRevision: "1:assistant-2",
					isLiveTail: false,
				},
			],
			viewport: { hasLiveTail: true, requiresStableTailMount: true },
		};
		const displayPatchedEntries = applyAgentPanelDisplayModelToSceneEntries(
			displayModel,
			createAgentPanelDisplayMemory(),
			baseEntries
		);

		const patchedEntries = readModel.applyPatch({
			sceneEntries: displayPatchedEntries,
			sourceEntry: revealAssistantEntry,
			tailRowId: "assistant-1",
			tailRowIndex: 0,
			tokenRevealCss,
		});

		expect(patchedEntries).not.toBeNull();
		expect(patchedEntries?.[0]).toBe(firstEntries[0]);
		expect(patchedEntries?.[1]).toMatchObject({
			id: "assistant-2",
			markdown: "Display override",
		});
	});

	it("applies truncation patches without rebuilding the existing reveal overlay", () => {
		const readModel = createTokenRevealSceneReadModel();
		const assistantEntry: AgentPanelSceneEntryModel = {
			id: "assistant-1",
			type: "assistant",
			markdown: "Answer",
			isStreaming: true,
		};
		const toolEntry: AgentPanelSceneEntryModel = {
			id: "tool-1",
			type: "tool_call",
			kind: "execute",
			title: "Read file",
			status: "done",
		};
		const baseEntries = [assistantEntry, toolEntry];
		const tokenRevealCss = createTokenRevealCss();

		const firstEntries = readModel.applySnapshot({
			sceneEntries: baseEntries,
			sourceEntry: assistantEntry,
			tailRowId: "assistant-1",
			tailRowIndex: 0,
			tokenRevealCss,
		});
		const truncatedEntries = [assistantEntry];
		markAgentPanelSceneEntryArrayTruncation(truncatedEntries, {
			baseSceneEntries: baseEntries,
			length: 1,
		});

		const patchedEntries = readModel.applyPatch({
			sceneEntries: truncatedEntries,
			sourceEntry: assistantEntry,
			tailRowId: "assistant-1",
			tailRowIndex: 0,
			tokenRevealCss,
		});

		expect(patchedEntries).not.toBeNull();
		expect(patchedEntries).toHaveLength(1);
		expect(patchedEntries?.[0]).toBe(firstEntries[0]);
	});

	it("keeps stable truncation updates on the patch lane", () => {
		const readModel = createTokenRevealSceneReadModel();
		const assistantEntry: AgentPanelSceneEntryModel = {
			id: "assistant-1",
			type: "assistant",
			markdown: "Answer",
			isStreaming: true,
		};
		const toolEntry: AgentPanelSceneEntryModel = {
			id: "tool-1",
			type: "tool_call",
			kind: "execute",
			title: "Read file",
			status: "done",
		};
		const tokenRevealCss = createTokenRevealCss();
		const baseEntries = [assistantEntry, toolEntry];

		const firstEntries = readModel.applySnapshot({
			sceneEntries: baseEntries,
			sourceEntry: assistantEntry,
			tailRowId: "assistant-1",
			tailRowIndex: 0,
			tokenRevealCss,
		});

		const patchedEntries = readModel.applyPatch({
			sceneEntries: [assistantEntry],
			sourceEntry: assistantEntry,
			tailRowId: "assistant-1",
			tailRowIndex: 0,
			tokenRevealCss,
		});

		expect(patchedEntries).not.toBeNull();
		expect(patchedEntries).toHaveLength(1);
		expect(patchedEntries?.[0]).toBe(firstEntries[0]);
	});
});
