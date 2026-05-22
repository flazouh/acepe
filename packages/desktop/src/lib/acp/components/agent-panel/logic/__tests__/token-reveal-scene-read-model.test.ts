import type { AgentPanelSceneEntryModel, TokenRevealCss } from "@acepe/ui/agent-panel";
import { describe, expect, it } from "vitest";
import { createTokenRevealSceneReadModel } from "../token-reveal-scene-read-model.js";

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
			sourceEntriesById: new Map(entries.map((entry) => [entry.id, entry])),
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
			sourceEntriesById: new Map([[sourceAssistantEntry.id, sourceAssistantEntry]]),
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

	it("memoizes identical snapshots", () => {
		const readModel = createTokenRevealSceneReadModel();
		const assistantEntry: AgentPanelSceneEntryModel = {
			id: "assistant-1",
			type: "assistant",
			markdown: "Answer",
			isStreaming: true,
		};
		const sourceEntriesById = new Map([[assistantEntry.id, assistantEntry]]);
		const tokenRevealCss = createTokenRevealCss();
		const snapshot = {
			sceneEntries: [assistantEntry],
			sourceEntriesById,
			tailRowId: "assistant-1",
			tokenRevealCss,
		};

		const firstEntries = readModel.applySnapshot(snapshot);
		const secondEntries = readModel.applySnapshot(snapshot);

		expect(secondEntries).toBe(firstEntries);
		expect(readModel.selectSettlingTimings()).toEqual([]);
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
		const sourceEntriesById = new Map([[assistantEntry.id, assistantEntry]]);
		const firstCss = createTokenRevealCss();
		const nextCss: TokenRevealCss = {
			...firstCss,
			revealCount: firstCss.revealCount + 1,
		};

		const firstEntries = readModel.applySnapshot({
			sceneEntries: [userEntry, assistantEntry],
			sourceEntriesById,
			tailRowId: "assistant-1",
			tokenRevealCss: firstCss,
		});
		const nextEntries = readModel.applySnapshot({
			sceneEntries: [userEntry, assistantEntry],
			sourceEntriesById,
			tailRowId: "assistant-1",
			tokenRevealCss: nextCss,
		});

		expect(firstEntries[0]).toBe(userEntry);
		expect(nextEntries[0]).toBe(userEntry);
		expect(firstEntries[1]).toMatchObject({ id: "assistant-1", tokenRevealCss: firstCss });
		expect(nextEntries[1]).toMatchObject({ id: "assistant-1", tokenRevealCss: nextCss });
	});
});
