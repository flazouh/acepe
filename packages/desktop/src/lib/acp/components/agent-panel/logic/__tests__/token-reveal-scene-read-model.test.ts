import type { AgentPanelSceneEntryModel, TokenRevealCss } from "@acepe/ui/agent-panel";
import { describe, expect, it } from "vitest";
import { createTokenRevealSceneReadModel } from "../token-reveal-scene-read-model.js";
import {
	scenePatchGraphScene,
	scenePatchGraphSceneAppend,
	scenePatchGraphSceneTruncation,
} from "../scene-patch.js";
import { withIdentityScenePatch } from "./scene-patch-test-helpers.js";
import { buildRevealScenePatchedEntriesWithPatch } from "../reveal-scene-patch.js";

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

		const selectedResult = readModel.applySnapshot(withIdentityScenePatch({
			sceneEntries: entries,
			sourceEntry: undefined,
			tailRowId: null,
			tokenRevealCss: undefined,
		}));

		expect(selectedResult.entries).toBe(entries);
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

		const selectedResult = readModel.applySnapshot(withIdentityScenePatch({
			sceneEntries: [userEntry, assistantEntry],
			sourceEntry: sourceAssistantEntry,
			tailRowId: "assistant-1",
			tokenRevealCss,
		}));

		expect(selectedResult.entries[0]).toBe(userEntry);
		expect(selectedResult.entries[1]).not.toBe(assistantEntry);
		expect(selectedResult.entries[1]).toMatchObject({
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
			const selectedResult = readModel.applySnapshot(withIdentityScenePatch({
				sceneEntries,
				sourceEntry: assistantEntry,
				tailRowId: "assistant-1",
				tokenRevealCss,
			}));

			expect(Array.isArray(selectedResult.entries)).toBe(true);
			expect(selectedResult.entries.length).toBe(2);
			expect(selectedResult.entries[0]).toBe(userEntry);
			expect(selectedResult.entries[1]).not.toBe(assistantEntry);
			expect(selectedResult.entries[1]).toMatchObject({
				id: "assistant-1",
				tokenRevealCss,
			});
			expect([...selectedResult.entries][0]).toBe(userEntry);
			expect([...selectedResult.entries][1]).toMatchObject({
				id: "assistant-1",
				tokenRevealCss,
			});
			expect(selectedResult.entries.slice()[1]).toMatchObject({
				id: "assistant-1",
				tokenRevealCss,
			});
			expect(selectedResult.entries.at(1)).toMatchObject({
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
		const snapshot = withIdentityScenePatch({
			sceneEntries: [assistantEntry],
			sourceEntry: assistantEntry,
			tailRowId: "assistant-1",
			tokenRevealCss,
		});

		const firstResult = readModel.applySnapshot(snapshot);
		const secondResult = readModel.applySnapshot(snapshot);

		expect(secondResult.entries).toBe(firstResult.entries);
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
		const firstResult = readModel.applySnapshot(withIdentityScenePatch({
			sceneEntries: [assistantEntry, toolEntry],
			sourceEntry: assistantEntry,
			tailRowId: "assistant-1",
			tailRowIndex: 0,
			tokenRevealCss,
		}));

		const patchedResult = readModel.applyPatch(withIdentityScenePatch({
			sceneEntries: [{ ...assistantEntry }, { ...toolEntry }],
			sourceEntry: assistantEntry,
			tailRowId: "assistant-1",
			tailRowIndex: 0,
			tokenRevealCss,
		}));

		expect(patchedResult?.entries).toBe(firstResult.entries);
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

		const firstResult = readModel.applySnapshot(withIdentityScenePatch({
			sceneEntries: [userEntry, assistantEntry],
			sourceEntry: assistantEntry,
			tailRowId: "assistant-1",
			tokenRevealCss: firstCss,
		}));
		const nextResult = readModel.applySnapshot(withIdentityScenePatch({
			sceneEntries: [userEntry, assistantEntry],
			sourceEntry: assistantEntry,
			tailRowId: "assistant-1",
			tokenRevealCss: nextCss,
		}));

		expect(firstResult.entries[0]).toBe(userEntry);
		expect(nextResult.entries[0]).toBe(userEntry);
		expect(firstResult.entries[1]).toMatchObject({ id: "assistant-1", tokenRevealCss: firstCss });
		expect(nextResult.entries[1]).toMatchObject({ id: "assistant-1", tokenRevealCss: nextCss });
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

		const selectedResult = readModel.applySnapshot(withIdentityScenePatch({
			sceneEntries: [earlierAssistantEntry, tailAssistantEntry],
			sourceEntry: tailAssistantEntry,
			tailRowId: "assistant-tail",
			tailRowIndex: 1,
			tokenRevealCss,
		}));

		expect(selectedResult.entries[0]).toBe(earlierAssistantEntry);
		expect(selectedResult.entries[1]).not.toBe(tailAssistantEntry);
		expect(selectedResult.entries[1]).toMatchObject({
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

		readModel.applySnapshot(withIdentityScenePatch({
			sceneEntries: baseEntries,
			sourceEntry: firstAssistantEntry,
			tailRowId: "assistant-1",
			tailRowIndex: 0,
			tokenRevealCss,
		}));

		const movedResult = readModel.applySnapshot(withIdentityScenePatch({
			sceneEntries: baseEntries,
			sourceEntry: secondAssistantEntry,
			tailRowId: "assistant-2",
			tailRowIndex: 1,
			tokenRevealCss,
		}));

		expect(movedResult.scenePatch.kind).toBe("tokenReveal");
		if (movedResult.scenePatch.kind !== "tokenReveal") {
			return;
		}
		expect(movedResult.scenePatch.patch.baseSceneEntries).toBe(baseEntries);
		expect(movedResult.scenePatch.patch.entries).toHaveLength(2);
		expect(movedResult.scenePatch.patch.entries[0]).toMatchObject({
			id: "assistant-2",
			tokenRevealCss,
		});
		expect(movedResult.scenePatch.patch.entries[1]).toBe(firstAssistantEntry);
		expect(movedResult.entries[0]).toBe(firstAssistantEntry);
		expect(movedResult.entries[1]).not.toBe(secondAssistantEntry);
		expect(movedResult.entries[1]).toMatchObject({ id: "assistant-2", tokenRevealCss });
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

		const firstResult = readModel.applySnapshot(withIdentityScenePatch({
			sceneEntries: baseEntries,
			sourceEntry: assistantEntry,
			tailRowId: "assistant-1",
			tailRowIndex: 0,
			tokenRevealCss,
		}));
		const appendedEntries = [...baseEntries, toolEntry];

		const patchedResult = readModel.applyPatch({
			sceneEntries: appendedEntries,
			scenePatch: scenePatchGraphSceneAppend({
				baseSceneEntries: baseEntries,
				appendedEntries: [toolEntry],
			}),
			sourceEntry: assistantEntry,
			tailRowId: "assistant-1",
			tailRowIndex: 0,
			tokenRevealCss,
		});

		expect(patchedResult).not.toBeNull();
		if (patchedResult === null) {
			return;
		}
		expect(patchedResult.entries[0]).toBe(firstResult.entries[0]);
		expect(patchedResult.entries[1]).toBe(toolEntry);
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

		const firstResult = readModel.applySnapshot(withIdentityScenePatch({
			sceneEntries: baseEntries,
			sourceEntry: assistantEntry,
			tailRowId: "assistant-1",
			tailRowIndex: 0,
			tokenRevealCss,
		}));

		const patchedResult = readModel.applyPatch(withIdentityScenePatch({
			sceneEntries: [assistantEntry, toolEntry],
			sourceEntry: assistantEntry,
			tailRowId: "assistant-1",
			tailRowIndex: 0,
			tokenRevealCss,
		}));

		expect(patchedResult).not.toBeNull();
		if (patchedResult === null) {
			return;
		}
		expect(patchedResult.entries[0]).toBe(firstResult.entries[0]);
		expect(patchedResult.entries[1]).toBe(toolEntry);
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

		const firstResult = readModel.applySnapshot(withIdentityScenePatch({
			sceneEntries: baseEntries,
			sourceEntry: assistantEntry,
			tailRowId: "assistant-1",
			tailRowIndex: 0,
			tokenRevealCss,
		}));
		const patchedBaseEntries = [assistantEntry, patchedToolEntry];
		const entriesByIndex = new Map<number, AgentPanelSceneEntryModel>([[1, patchedToolEntry]]);

		const patchedResult = readModel.applyPatch({
			sceneEntries: patchedBaseEntries,
			scenePatch: scenePatchGraphScene({
				baseSceneEntries: baseEntries,
				entries: [patchedToolEntry],
				entriesByIndex,
			}),
			sourceEntry: assistantEntry,
			tailRowId: "assistant-1",
			tailRowIndex: 0,
			tokenRevealCss,
		});

		expect(patchedResult).not.toBeNull();
		if (patchedResult === null) {
			return;
		}
		expect(patchedResult.entries[0]).toBe(firstResult.entries[0]);
		expect(patchedResult.entries[1]).toBe(patchedToolEntry);
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

		const firstResult = readModel.applySnapshot(withIdentityScenePatch({
			sceneEntries: baseEntries,
			sourceEntry: revealAssistantEntry,
			tailRowId: "assistant-1",
			tailRowIndex: 0,
			tokenRevealCss,
		}));

		const displayRevealResult = buildRevealScenePatchedEntriesWithPatch(
			baseEntries,
			new Map([
				[1, { id: "assistant-2", type: "assistant", markdown: "Display override", isStreaming: false }],
			])
		);

		const patchedResult = readModel.applyPatch({
			sceneEntries: displayRevealResult.entries,
			scenePatch: displayRevealResult.scenePatch,
			sourceEntry: revealAssistantEntry,
			tailRowId: "assistant-1",
			tailRowIndex: 0,
			tokenRevealCss,
		});

		expect(patchedResult).not.toBeNull();
		if (patchedResult === null) {
			return;
		}
		expect(patchedResult.entries[0]).toBe(firstResult.entries[0]);
		expect(patchedResult.entries[1]).toMatchObject({
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

		const firstResult = readModel.applySnapshot(withIdentityScenePatch({
			sceneEntries: baseEntries,
			sourceEntry: assistantEntry,
			tailRowId: "assistant-1",
			tailRowIndex: 0,
			tokenRevealCss,
		}));
		const truncatedEntries = [assistantEntry];

		const patchedResult = readModel.applyPatch({
			sceneEntries: truncatedEntries,
			scenePatch: scenePatchGraphSceneTruncation({
				baseSceneEntries: baseEntries,
				length: 1,
			}),
			sourceEntry: assistantEntry,
			tailRowId: "assistant-1",
			tailRowIndex: 0,
			tokenRevealCss,
		});

		expect(patchedResult).not.toBeNull();
		if (patchedResult === null) {
			return;
		}
		expect(patchedResult.entries).toHaveLength(1);
		expect(patchedResult.entries[0]).toBe(firstResult.entries[0]);
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

		const firstResult = readModel.applySnapshot(withIdentityScenePatch({
			sceneEntries: baseEntries,
			sourceEntry: assistantEntry,
			tailRowId: "assistant-1",
			tailRowIndex: 0,
			tokenRevealCss,
		}));

		const patchedResult = readModel.applyPatch(withIdentityScenePatch({
			sceneEntries: [assistantEntry],
			sourceEntry: assistantEntry,
			tailRowId: "assistant-1",
			tailRowIndex: 0,
			tokenRevealCss,
		}));

		expect(patchedResult).not.toBeNull();
		if (patchedResult === null) {
			return;
		}
		expect(patchedResult.entries).toHaveLength(1);
		expect(patchedResult.entries[0]).toBe(firstResult.entries[0]);
	});
});
