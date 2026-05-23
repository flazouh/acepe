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
import {
	createTokenRevealSceneReadModel,
	getTokenRevealScenePatch,
} from "../token-reveal-scene-read-model.js";
import {
	applyAgentPanelDisplayModelToSceneEntries,
	createAgentPanelDisplayMemory,
	getAgentPanelDisplayScenePatch,
	type AgentPanelDisplayModel,
} from "../agent-panel-display-model.js";
import { markAgentPanelSceneEntryArrayPatch } from "../../../../session-state/agent-panel-scene-entry-array-patch.js";

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

		const firstRows = readModel.applySnapshot(entries);
		const secondRows = readModel.applySnapshot(entries);

		expect(secondRows).toBe(firstRows);
	});

	it("selects the latest row timestamp from snapshots and append patches", () => {
		const readModel = createSceneDisplayRowsReadModel();
		readModel.applySnapshot([
			{ id: "user-1", type: "user", text: "Prompt", timestampMs: 10 },
			{ id: "assistant-1", type: "assistant", markdown: "First", timestampMs: 20 },
		]);

		expect(readModel.selectLatestTimestampMs()).toBe(20);

		readModel.applyAppendPatch([
			{ id: "assistant-2", type: "assistant", markdown: "Second", timestampMs: 30 },
		]);

		expect(readModel.selectLatestTimestampMs()).toBe(30);
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
		const firstRows = readModel.applySnapshot([firstUser, firstAssistant]);

		const nextRows = readModel.applySnapshot([firstUser, firstAssistant, nextAssistant]);

		expect(nextRows[0]).toBe(firstRows[0]);
		expect(nextRows.map((row) => getSceneDisplayRowKey(row))).toEqual(["user-1", "assistant-1"]);
		expect(nextRows[1]?.type).toBe("assistant_merged");
		if (nextRows[1]?.type === "assistant_merged") {
			expect(nextRows[1].markdown).toBe("FirstSecond");
		}
	});

	it("exposes snapshot, append patch, and select rows operations", () => {
		const readModel = createSceneDisplayRowsReadModel();
		const snapshotRows = readModel.applySnapshot([
			{ id: "user-1", type: "user", text: "Prompt" },
			{ id: "assistant-1", type: "assistant", markdown: "First" },
		]);

		const patchedRows = readModel.applyAppendPatch([
			{ id: "assistant-2", type: "assistant", markdown: "Second" },
		]);

		expect(patchedRows[0]).toBe(snapshotRows[0]);
		expect(readModel.selectRows()).toBe(patchedRows);
		expect(patchedRows.map((row) => getSceneDisplayRowKey(row))).toEqual([
			"user-1",
			"assistant-1",
		]);
		expect(patchedRows[1]?.type).toBe("assistant_merged");
		if (patchedRows[1]?.type === "assistant_merged") {
			expect(patchedRows[1].markdown).toBe("FirstSecond");
		}
	});

	it("keeps selected rows stable for empty append patches", () => {
		const readModel = createSceneDisplayRowsReadModel();
		const snapshotRows = readModel.applySnapshot([
			{ id: "user-1", type: "user", text: "Prompt" },
		]);

		expect(readModel.applyAppendPatch([])).toBe(snapshotRows);
		expect(readModel.selectRows()).toBe(snapshotRows);
	});

	it("applies display scene patches without scanning unchanged scene entries", () => {
		const readModel = createSceneDisplayRowsReadModel();
		const sceneEntries: AgentPanelSceneEntryModel[] = [
			{ id: "user-1", type: "user", text: "Prompt" },
			{ id: "tool-1", type: "tool_call", title: "Run", status: "done" },
			{ id: "assistant-1", type: "assistant", markdown: "" },
		];
		const initialRows = readModel.applySnapshot(sceneEntries);
		const model: AgentPanelDisplayModel = {
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
					canonicalText: "Patched",
					displayText: "Patched",
					canonicalTextRevision: "1:assistant-1",
					isLiveTail: false,
				},
			],
			viewport: { hasLiveTail: false, requiresStableTailMount: false },
		};
		const displayedEntries = applyAgentPanelDisplayModelToSceneEntries(
			model,
			createAgentPanelDisplayMemory(),
			sceneEntries
		);
		const patch = getAgentPanelDisplayScenePatch(displayedEntries);
		expect(patch?.entriesByIndex.get(2)).toMatchObject({
			id: "assistant-1",
			markdown: "Patched",
		});
		let originalPatchIterator: (() => IterableIterator<AgentPanelSceneEntryModel>) | undefined;
		if (patch !== undefined) {
			originalPatchIterator = patch.entries[Symbol.iterator].bind(patch.entries);
			Object.defineProperty(patch.entries, Symbol.iterator, {
				configurable: true,
				value: () => {
					throw new Error("must not iterate display patch entries directly");
				},
			});
		}
		Object.defineProperty(sceneEntries, "1", {
			configurable: true,
			get() {
				throw new Error("must not scan unchanged scene entries for a display patch");
			},
		});

		try {
			const patchedRows = readModel.applySnapshot(displayedEntries);

			expect(patchedRows[0]).toBe(initialRows[0]);
			expect(patchedRows[1]).toBe(initialRows[1]);
			expect(patchedRows[2]).toMatchObject({
				type: "assistant_merged",
				markdown: "Patched",
			});
		} finally {
			Object.defineProperty(sceneEntries, "1", {
				configurable: true,
				value: { id: "tool-1", type: "tool_call", title: "Run", status: "done" },
			});
			if (patch !== undefined && originalPatchIterator !== undefined) {
				Object.defineProperty(patch.entries, Symbol.iterator, {
					configurable: true,
					value: originalPatchIterator,
				});
			}
		}
	});

	it("applies graph scene patches without scanning unchanged scene entries", () => {
		const readModel = createSceneDisplayRowsReadModel();
		const userEntry = {
			id: "user-1",
			type: "user",
			text: "Prompt",
		} satisfies AgentPanelSceneEntryModel;
		const toolEntry = {
			id: "tool-1",
			type: "tool_call",
			title: "Run",
			status: "running",
		} satisfies AgentPanelSceneEntryModel;
		const assistantEntry = {
			id: "assistant-1",
			type: "assistant",
			markdown: "Answer",
		} satisfies AgentPanelSceneEntryModel;
		const baseEntries = [userEntry, toolEntry, assistantEntry];
		const baseRows = readModel.applySnapshot(baseEntries);
		const nextToolEntry = {
			...toolEntry,
			status: "done",
		} satisfies AgentPanelSceneEntryModel;
		const patchedEntryList = [nextToolEntry];
		const originalPatchedEntryListIterator = patchedEntryList[Symbol.iterator];
		patchedEntryList[Symbol.iterator] = () => {
			throw new Error("must use indexed scene entry patches");
		};
		const patchedEntries = [userEntry, nextToolEntry, assistantEntry];
		markAgentPanelSceneEntryArrayPatch(patchedEntries, {
			baseSceneEntries: baseEntries,
			entries: patchedEntryList,
			entriesByIndex: new Map([[1, nextToolEntry]]),
		});
		Object.defineProperty(patchedEntries, "0", {
			configurable: true,
			get() {
				throw new Error("must not scan unchanged scene entries for graph scene patch");
			},
		});
		Object.defineProperty(patchedEntries, "2", {
			configurable: true,
			get() {
				throw new Error("must not scan unchanged scene entries for graph scene patch");
			},
		});

		try {
			const patchedRows = readModel.applyPatch(patchedEntries);

			expect(patchedRows).not.toBeNull();
			if (patchedRows === null) {
				return;
			}
			expect(patchedRows[0]).toBe(baseRows[0]);
			expect(patchedRows[1]).toBe(baseRows[1]);
			expect(patchedRows[2]).toBe(baseRows[2]);
			expect(patchedRows[1]).toMatchObject({
				id: "tool-1",
				type: "tool_call",
			});
		} finally {
			Object.defineProperty(patchedEntries, "0", {
				configurable: true,
				value: userEntry,
			});
			Object.defineProperty(patchedEntries, "2", {
				configurable: true,
				value: assistantEntry,
			});
			patchedEntryList[Symbol.iterator] = originalPatchedEntryListIterator;
		}
	});

	it("does not treat unmarked scene entries as graph scene patches", () => {
		const readModel = createSceneDisplayRowsReadModel();
		const userEntry = {
			id: "user-1",
			type: "user",
			text: "Prompt",
		} satisfies AgentPanelSceneEntryModel;
		readModel.applySnapshot([userEntry]);

		expect(readModel.applyPatch([userEntry])).toBeNull();
	});

	it("uses append-only updates when prior scene entries are fresh objects but content-stable", () => {
		const readModel = createSceneDisplayRowsReadModel();
		const firstRows = readModel.applySnapshot([
			{ id: "user-1", type: "user", text: "Prompt", timestampMs: 1 },
			{ id: "assistant-1", type: "assistant", markdown: "First", timestampMs: 2 },
		]);

		const nextRows = readModel.applySnapshot([
			{ id: "user-1", type: "user", text: "Prompt", timestampMs: 1 },
			{ id: "assistant-1", type: "assistant", markdown: "First", timestampMs: 2 },
			{ id: "assistant-2", type: "assistant", markdown: "Second", timestampMs: 3 },
		]);

		expect(nextRows[0]).toBe(firstRows[0]);
		expect(nextRows.map((row) => getSceneDisplayRowKey(row))).toEqual(["user-1", "assistant-1"]);
		expect(nextRows[1]?.type).toBe("assistant_merged");
		if (nextRows[1]?.type === "assistant_merged") {
			expect(nextRows[1].markdown).toBe("FirstSecond");
		}
	});

	it("keeps rows stable when a fresh snapshot has the same content and no appended entries", () => {
		const readModel = createSceneDisplayRowsReadModel();
		const firstRows = readModel.applySnapshot([
			{ id: "user-1", type: "user", text: "Prompt", timestampMs: 1 },
			{ id: "assistant-1", type: "assistant", markdown: "First", timestampMs: 2 },
		]);

		const nextRows = readModel.applySnapshot([
			{ id: "user-1", type: "user", text: "Prompt", timestampMs: 1 },
			{ id: "assistant-1", type: "assistant", markdown: "First", timestampMs: 2 },
		]);

		expect(nextRows).toBe(firstRows);
	});

	it("patches same-length scene entry changes without rebuilding unchanged rows", () => {
		const readModel = createSceneDisplayRowsReadModel();
		const userEntry = {
			id: "user-1",
			type: "user",
			text: "Prompt",
			timestampMs: 1,
		} satisfies AgentPanelSceneEntryModel;
		const assistantEntry = {
			id: "assistant-1",
			type: "assistant",
			markdown: "Answer",
			timestampMs: 2,
		} satisfies AgentPanelSceneEntryModel;
		const firstRows = readModel.applySnapshot([userEntry, assistantEntry]);

		const nextRows = readModel.applySnapshot([
			userEntry,
			{ ...assistantEntry, markdown: "Answer changed", timestampMs: 3 },
		]);

		expect(nextRows).not.toBe(firstRows);
		expect(nextRows[0]).toBe(firstRows[0]);
		expect(nextRows[1]).not.toBe(firstRows[1]);
		expect(readModel.selectLatestTimestampMs()).toBe(3);
	});

	it("patches same-length scene entry changes without slicing the whole row array", () => {
		const readModel = createSceneDisplayRowsReadModel();
		const userEntry = {
			id: "user-1",
			type: "user",
			text: "Prompt",
			timestampMs: 1,
		} satisfies AgentPanelSceneEntryModel;
		const assistantEntry = {
			id: "assistant-1",
			type: "assistant",
			markdown: "Answer",
			timestampMs: 2,
		} satisfies AgentPanelSceneEntryModel;
		const firstRows = readModel.applySnapshot([userEntry, assistantEntry]);
		const originalSlice = firstRows.slice;

		firstRows.slice = () => {
			throw new Error("must not slice whole display rows");
		};

		try {
			const nextRows = readModel.applySnapshot([
				userEntry,
				{ ...assistantEntry, markdown: "Answer changed", timestampMs: 3 },
			]);

			expect(nextRows).toHaveLength(2);
			expect(nextRows[0]).toBe(firstRows[0]);
			expect(nextRows[1]).not.toBe(firstRows[1]);
			expect(nextRows.map((row) => getSceneDisplayRowKey(row))).toEqual([
				"user-1",
				"assistant-1",
			]);
			expect(readModel.selectLatestTimestampMs()).toBe(3);
		} finally {
			firstRows.slice = originalSlice;
		}
	});

	it("skips marked row rewrites when a patched scene entry renders the same row", () => {
		const readModel = createSceneDisplayRowsReadModel();
		const userEntry = {
			id: "user-1",
			type: "user",
			text: "Prompt",
			timestampMs: 1,
		} satisfies AgentPanelSceneEntryModel;
		const assistantEntry = {
			id: "assistant-1",
			type: "assistant",
			markdown: "Answer",
			timestampMs: 2,
		} satisfies AgentPanelSceneEntryModel;
		const baseEntries = [userEntry, assistantEntry];
		const firstRows = readModel.applySnapshot(baseEntries);
		const nextAssistantEntry = {
			id: "assistant-1",
			type: "assistant",
			markdown: "Answer",
			timestampMs: 2,
		} satisfies AgentPanelSceneEntryModel;
		const patchedEntries = [userEntry, nextAssistantEntry];
		markAgentPanelSceneEntryArrayPatch(patchedEntries, {
			baseSceneEntries: baseEntries,
			entries: [nextAssistantEntry],
			entriesByIndex: new Map([[1, nextAssistantEntry]]),
		});

		const nextRows = readModel.applyPatch(patchedEntries);

		expect(nextRows).toBe(firstRows);
		expect(nextRows?.[0]).toBe(firstRows[0]);
		expect(nextRows?.[1]).toBe(firstRows[1]);
	});

	it("rebuilds rows when an existing scene entry changes content with the same id", () => {
		const readModel = createSceneDisplayRowsReadModel();
		const firstRows = readModel.applySnapshot([
			{ id: "user-1", type: "user", text: "Prompt" },
			{ id: "assistant-1", type: "assistant", markdown: "First" },
		]);

		const nextRows = readModel.applySnapshot([
			{ id: "user-1", type: "user", text: "Prompt changed" },
			{ id: "assistant-1", type: "assistant", markdown: "First" },
			{ id: "assistant-2", type: "assistant", markdown: "Second" },
		]);

		expect(nextRows[0]).not.toBe(firstRows[0]);
		expect(nextRows.map((row) => getSceneDisplayRowKey(row))).toEqual(["user-1", "assistant-1"]);
	});

	it("rebuilds rows when the scene is replaced instead of appended", () => {
		const readModel = createSceneDisplayRowsReadModel();
		const firstRows = readModel.applySnapshot([
			{ id: "user-1", type: "user", text: "Prompt" },
			{ id: "assistant-1", type: "assistant", markdown: "First" },
		]);

		const replacementRows = readModel.applySnapshot([
			{ id: "user-1", type: "user", text: "Prompt" },
			{ id: "assistant-2", type: "assistant", markdown: "Replacement" },
		]);

		expect(replacementRows).not.toBe(firstRows);
		expect(replacementRows.map((row) => getSceneDisplayRowKey(row))).toEqual([
			"user-1",
			"assistant-2",
		]);
	});

	it("patches only the token reveal assistant row", () => {
		const readModel = createSceneDisplayRowsReadModel();
		const tokenRevealReadModel = createTokenRevealSceneReadModel();
		const userEntry = {
			id: "user-1",
			type: "user",
			text: "Prompt",
		} satisfies AgentPanelSceneEntryModel;
		const assistantEntry = {
			id: "assistant-1",
			type: "assistant",
			markdown: "Answer",
			isStreaming: true,
		} satisfies AgentPanelSceneEntryModel;
		const baseEntries = [userEntry, assistantEntry];
		const baseRows = readModel.applySnapshot(baseEntries);

		const tokenRevealRows = readModel.applySnapshot(
			tokenRevealReadModel.applySnapshot({
				sceneEntries: baseEntries,
				sourceEntry: assistantEntry,
				tailRowId: "assistant-1",
				tailRowIndex: 1,
				tokenRevealCss: {
					revealCount: 1,
					revealedCharCount: 6,
					baselineMs: 0,
					tokStepMs: 20,
					tokFadeDurMs: 80,
					mode: "smooth",
				},
			})
		);

		expect(tokenRevealRows[0]).toBe(baseRows[0]);
		expect(tokenRevealRows[1]).not.toBe(baseRows[1]);
		expect(tokenRevealRows[1]?.type).toBe("assistant_merged");
		if (tokenRevealRows[1]?.type === "assistant_merged") {
			expect(tokenRevealRows[1].tokenRevealCss?.revealCount).toBe(1);
		}

		expect(readModel.applySnapshot(baseEntries)).toBe(baseRows);
	});

	it("patches only the affected display rows when the token reveal tail moves", () => {
		const readModel = createSceneDisplayRowsReadModel();
		const tokenRevealReadModel = createTokenRevealSceneReadModel();
		const firstAssistantEntry = {
			id: "assistant-1",
			type: "assistant",
			markdown: "First",
			isStreaming: true,
		} satisfies AgentPanelSceneEntryModel;
		const secondAssistantEntry = {
			id: "assistant-2",
			type: "assistant",
			markdown: "Second",
			isStreaming: true,
		} satisfies AgentPanelSceneEntryModel;
		const baseEntries = [firstAssistantEntry, secondAssistantEntry];
		const baseRows = readModel.applySnapshot(baseEntries);
		readModel.applySnapshot(
			tokenRevealReadModel.applySnapshot({
				sceneEntries: baseEntries,
				sourceEntry: firstAssistantEntry,
				tailRowId: "assistant-1",
				tailRowIndex: 0,
				tokenRevealCss: {
					revealCount: 1,
					revealedCharCount: 6,
					baselineMs: 0,
					tokStepMs: 20,
					tokFadeDurMs: 80,
					mode: "smooth",
				},
			})
		);

		const movedRevealRows = readModel.applySnapshot(
			tokenRevealReadModel.applySnapshot({
				sceneEntries: baseEntries,
				sourceEntry: secondAssistantEntry,
				tailRowId: "assistant-2",
				tailRowIndex: 1,
				tokenRevealCss: {
					revealCount: 1,
					revealedCharCount: 6,
					baselineMs: 0,
					tokStepMs: 20,
					tokFadeDurMs: 80,
					mode: "smooth",
				},
			})
		);

		expect(movedRevealRows[0]).toBe(baseRows[0]);
		expect(movedRevealRows[1]).not.toBe(baseRows[1]);
		if (movedRevealRows[1]?.type === "assistant_merged") {
			expect(movedRevealRows[1].tokenRevealCss?.revealCount).toBe(1);
		}
	});

	it("patches token reveal rows without slicing the whole row array", () => {
		const readModel = createSceneDisplayRowsReadModel();
		const tokenRevealReadModel = createTokenRevealSceneReadModel();
		const userEntry = {
			id: "user-1",
			type: "user",
			text: "Prompt",
		} satisfies AgentPanelSceneEntryModel;
		const assistantEntry = {
			id: "assistant-1",
			type: "assistant",
			markdown: "Answer",
			isStreaming: true,
		} satisfies AgentPanelSceneEntryModel;
		const baseEntries = [userEntry, assistantEntry];
		const baseRows = readModel.applySnapshot(baseEntries);
		const originalSlice = baseRows.slice;

		baseRows.slice = () => {
			throw new Error("must not slice whole display rows");
		};

		try {
			const tokenRevealRows = readModel.applySnapshot(
				tokenRevealReadModel.applySnapshot({
					sceneEntries: baseEntries,
					sourceEntry: assistantEntry,
					tailRowId: "assistant-1",
					tailRowIndex: 1,
					tokenRevealCss: {
						revealCount: 1,
						revealedCharCount: 6,
						baselineMs: 0,
						tokStepMs: 20,
						tokFadeDurMs: 80,
						mode: "smooth",
					},
				})
			);

			expect(Array.isArray(tokenRevealRows)).toBe(true);
			expect(tokenRevealRows).toHaveLength(2);
			expect(tokenRevealRows[0]).toBe(baseRows[0]);
			expect(tokenRevealRows[1]).not.toBe(baseRows[1]);
			expect(tokenRevealRows.map((row) => getSceneDisplayRowKey(row))).toEqual([
				"user-1",
				"assistant-1",
			]);
			expect([...tokenRevealRows][1]).toMatchObject({
				type: "assistant_merged",
				tokenRevealCss: {
					revealCount: 1,
				},
			});
		} finally {
			baseRows.slice = originalSlice;
		}
	});

	it("applies token reveal patches from indexed entries instead of filtering patch lists", () => {
		const readModel = createSceneDisplayRowsReadModel();
		const tokenRevealReadModel = createTokenRevealSceneReadModel();
		const userEntry = {
			id: "user-1",
			type: "user",
			text: "Prompt",
		} satisfies AgentPanelSceneEntryModel;
		const assistantEntry = {
			id: "assistant-1",
			type: "assistant",
			markdown: "Answer",
			isStreaming: true,
		} satisfies AgentPanelSceneEntryModel;
		const baseEntries = [userEntry, assistantEntry];
		const baseRows = readModel.applySnapshot(baseEntries);
		const tokenRevealEntries = tokenRevealReadModel.applySnapshot({
			sceneEntries: baseEntries,
			sourceEntry: assistantEntry,
			tailRowId: "assistant-1",
			tailRowIndex: 1,
			tokenRevealCss: {
				revealCount: 1,
				revealedCharCount: 6,
				baselineMs: 0,
				tokStepMs: 20,
				tokFadeDurMs: 80,
				mode: "smooth",
			},
		});
		const patch = getTokenRevealScenePatch(tokenRevealEntries);
		expect(patch).toBeDefined();
		const originalFilter = patch?.entries.filter;
		if (patch !== undefined) {
			patch.entries.filter = () => {
				throw new Error("must use indexed token reveal scene patches");
			};
		}

		try {
			const patchedRows = readModel.applyPatch(tokenRevealEntries);
			expect(patchedRows).not.toBeNull();
			expect(patchedRows?.[0]).toBe(baseRows[0]);
			expect(patchedRows?.[1]).not.toBe(baseRows[1]);
		} finally {
			if (patch !== undefined && originalFilter !== undefined) {
				patch.entries.filter = originalFilter;
			}
		}
	});
});
