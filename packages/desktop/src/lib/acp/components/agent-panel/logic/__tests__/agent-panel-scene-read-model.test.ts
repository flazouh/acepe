import type { AgentPanelSceneEntryModel } from "@acepe/ui/agent-panel";
import { describe, expect, it } from "vitest";

import { createAgentPanelSceneReadModel } from "../agent-panel-scene-read-model.js";
import {
	applyAgentPanelDisplayModelToSceneEntries,
	createAgentPanelDisplayMemory,
	type AgentPanelDisplayModel,
} from "../agent-panel-display-model.js";
import { getSceneDisplayRowKey, THINKING_DISPLAY_ENTRY } from "../scene-display-rows.js";
import { createTokenRevealSceneReadModel } from "../token-reveal-scene-read-model.js";
import {
	markAgentPanelSceneEntryArrayAppendPatch,
	markAgentPanelSceneEntryArrayPatch,
	markAgentPanelSceneEntryArrayTruncation,
} from "../../../../session-state/agent-panel-scene-entry-array-patch.js";

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

	it("applies append patches without copying the previous scene entry list", () => {
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
		const nextToolEntry: AgentPanelSceneEntryModel = {
			id: "tool-1",
			type: "tool_call",
			title: "Run",
			status: "done",
		};
		const entries = [userEntry, assistantEntry];
		readModel.applySnapshot(entries);
		const originalConcat = entries.concat;

		entries.concat = () => {
			throw new Error("must not copy previous scene entries for append patches");
		};

		try {
			const patchedSnapshot = readModel.applyAppendPatch([nextToolEntry]);

			expect(patchedSnapshot.rows.map((row) => getSceneDisplayRowKey(row))).toEqual([
				"user-1",
				"assistant-1",
				"tool-1",
			]);
			expect(patchedSnapshot.entriesById.get("tool-1")).toBe(nextToolEntry);
		} finally {
			entries.concat = originalConcat;
		}
	});

	it("applies marked full-scene append patches without scanning the unchanged prefix", () => {
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
		const nextToolEntry: AgentPanelSceneEntryModel = {
			id: "tool-1",
			type: "tool_call",
			title: "Run",
			status: "done",
		};
		const baseEntries = [userEntry, assistantEntry];
		const firstSnapshot = readModel.applySnapshot(baseEntries);
		const nextEntries = [userEntry, assistantEntry, nextToolEntry];
		markAgentPanelSceneEntryArrayAppendPatch(nextEntries, {
			baseSceneEntries: baseEntries,
			appendedEntries: [nextToolEntry],
		});
		Object.defineProperty(nextEntries, "0", {
			configurable: true,
			get() {
				throw new Error("must not scan unchanged scene entries for append patch");
			},
		});
		Object.defineProperty(nextEntries, "1", {
			configurable: true,
			get() {
				throw new Error("must not scan unchanged scene entries for append patch");
			},
		});

		try {
			const patchedSnapshot = readModel.applyPatch(nextEntries);

			expect(patchedSnapshot).not.toBeNull();
			if (patchedSnapshot === null) {
				return;
			}
			expect(patchedSnapshot.rows[0]).toBe(firstSnapshot.rows[0]);
			expect(patchedSnapshot.rows.map((row) => getSceneDisplayRowKey(row))).toEqual([
				"user-1",
				"assistant-1",
				"tool-1",
			]);
			expect(patchedSnapshot.entriesById).toBe(firstSnapshot.entriesById);
			expect(patchedSnapshot.entriesById.get("tool-1")).toBe(nextToolEntry);
		} finally {
			Object.defineProperty(nextEntries, "0", {
				configurable: true,
				value: userEntry,
			});
			Object.defineProperty(nextEntries, "1", {
				configurable: true,
				value: assistantEntry,
			});
		}
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

	it("applies marked tail truncation without checking the preserved scene prefix", () => {
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
			startedAtMs: 20,
		};
		const pendingEntry: AgentPanelSceneEntryModel = {
			id: "interaction:question-1",
			type: "tool_call",
			interactionId: "question-1",
			title: "Question",
			status: "running",
		};
		const baseEntries: AgentPanelSceneEntryModel[] = [userEntry, toolEntry, pendingEntry];
		const firstSnapshot = readModel.applySnapshot(baseEntries);
		const nextEntries = [userEntry, toolEntry];
		markAgentPanelSceneEntryArrayTruncation(nextEntries, {
			baseSceneEntries: baseEntries,
			length: nextEntries.length,
		});
		Object.defineProperty(baseEntries, "0", {
			configurable: true,
			get() {
				throw new Error("must not scan preserved scene entries for truncation patch");
			},
		});

		try {
			const truncatedSnapshot = readModel.applyPatch(nextEntries);

			expect(truncatedSnapshot).not.toBeNull();
			if (truncatedSnapshot === null) {
				return;
			}
			expect(truncatedSnapshot.rows[0]).toBe(firstSnapshot.rows[0]);
			expect(truncatedSnapshot.rows[1]).toBe(firstSnapshot.rows[1]);
			expect(truncatedSnapshot.entriesById).toBe(firstSnapshot.entriesById);
			expect(truncatedSnapshot.entriesById.has("interaction:question-1")).toBe(false);
		} finally {
			Object.defineProperty(baseEntries, "0", {
				configurable: true,
				value: userEntry,
			});
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

	it("applies graph scene patches without scanning unchanged scene entries", () => {
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
		const assistantEntry: AgentPanelSceneEntryModel = {
			id: "assistant-1",
			type: "assistant",
			markdown: "Answer",
		};
		const baseEntries = [userEntry, toolEntry, assistantEntry];
		const firstSnapshot = readModel.applySnapshot(baseEntries);
		const nextToolEntry: AgentPanelSceneEntryModel = {
			...toolEntry,
			status: "done",
		};
		const patchedEntries = [userEntry, nextToolEntry, assistantEntry];
		markAgentPanelSceneEntryArrayPatch(patchedEntries, {
			baseSceneEntries: baseEntries,
			entries: [nextToolEntry],
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
			const patchedSnapshot = readModel.applyPatch(patchedEntries);

			expect(patchedSnapshot).not.toBeNull();
			if (patchedSnapshot === null) {
				return;
			}
			expect(patchedSnapshot.rows[0]).toBe(firstSnapshot.rows[0]);
			expect(patchedSnapshot.rows[1]).not.toBe(firstSnapshot.rows[1]);
			expect(patchedSnapshot.rows[2]).toBe(firstSnapshot.rows[2]);
			expect(patchedSnapshot.rows[1]).toMatchObject({
				id: "tool-1",
				type: "tool_call",
			});
			expect(patchedSnapshot.entriesById).toBe(firstSnapshot.entriesById);
			expect(patchedSnapshot.entriesById.get("tool-1")).toBe(nextToolEntry);
			expect(readModel.selectGraphEntryForDisplayEntry(patchedSnapshot.rows[1])).toBe(
				nextToolEntry
			);
		} finally {
			Object.defineProperty(patchedEntries, "0", {
				configurable: true,
				value: userEntry,
			});
			Object.defineProperty(patchedEntries, "2", {
				configurable: true,
				value: assistantEntry,
			});
		}
	});

	it("does not treat unmarked scene entries as graph patches", () => {
		const readModel = createAgentPanelSceneReadModel();
		const userEntry: AgentPanelSceneEntryModel = {
			id: "user-1",
			type: "user",
			text: "Prompt",
		};
		readModel.applySnapshot([userEntry]);

		expect(readModel.applyPatch([userEntry])).toBeNull();
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

	it("patches stable transcript insertion without slicing the full scene", () => {
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
		readModel.applySnapshot([userEntry, nextToolEntry]);
		const nextSceneEntries = [userEntry, toolEntry, nextToolEntry];
		const originalSlice = nextSceneEntries.slice;

		nextSceneEntries.slice = () => {
			throw new Error("must not slice full scene for stable insertion");
		};

		try {
			const patchedSnapshot = readModel.applySnapshot(nextSceneEntries);

			expect(patchedSnapshot.rows.map((row) => getSceneDisplayRowKey(row))).toEqual([
				"user-1",
				"tool-1",
				"tool-2",
			]);
		} finally {
			nextSceneEntries.slice = originalSlice;
		}
	});

	it("patches assistant insertion without copying preserved display rows", () => {
		const readModel = createAgentPanelSceneReadModel();
		const userEntry: AgentPanelSceneEntryModel = {
			id: "user-1",
			type: "user",
			text: "Prompt",
			timestampMs: 10,
		};
		const firstAssistantEntry: AgentPanelSceneEntryModel = {
			id: "assistant-1",
			type: "assistant",
			markdown: "First",
			timestampMs: 20,
		};
		const secondAssistantEntry: AgentPanelSceneEntryModel = {
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
		const firstSnapshot = readModel.applySnapshot([userEntry, firstAssistantEntry, toolEntry]);
		const originalSlice = firstSnapshot.rows.slice;

		firstSnapshot.rows.slice = () => {
			throw new Error("must not copy preserved display rows for assistant insertion");
		};

		try {
			const patchedSnapshot = readModel.applySnapshot([
				userEntry,
				firstAssistantEntry,
				secondAssistantEntry,
				toolEntry,
			]);

			expect(patchedSnapshot.rows[0]).toBe(firstSnapshot.rows[0]);
			expect(patchedSnapshot.rows.map((row) => getSceneDisplayRowKey(row))).toEqual([
				"user-1",
				"assistant-1",
				"tool-1",
			]);
			expect(patchedSnapshot.rows[1]).toMatchObject({
				type: "assistant_merged",
				memberIds: ["assistant-1", "assistant-2"],
				markdown: "FirstSecond",
			});
		} finally {
			firstSnapshot.rows.slice = originalSlice;
		}
	});

	it("applies token reveal overlays through the patch path", () => {
		const readModel = createAgentPanelSceneReadModel();
		const tokenRevealReadModel = createTokenRevealSceneReadModel();
		const userEntry: AgentPanelSceneEntryModel = {
			id: "user-1",
			type: "user",
			text: "Prompt",
			timestampMs: 10,
		};
		const assistantEntry: AgentPanelSceneEntryModel = {
			id: "assistant-1",
			type: "assistant",
			markdown: "Display",
			isStreaming: true,
			timestampMs: 20,
		};
		const baseEntries = [userEntry, assistantEntry];
		const baseSnapshot = readModel.applySnapshot(baseEntries);
		const tokenRevealCss = {
			revealCount: 2,
			revealedCharCount: 7,
			baselineMs: 100,
			tokStepMs: 20,
			tokFadeDurMs: 80,
			mode: "smooth" as const,
		};

		const tokenRevealEntries = tokenRevealReadModel.applySnapshot({
			sceneEntries: baseEntries,
			sourceEntry: assistantEntry,
			tailRowId: "assistant-1",
			tailRowIndex: 1,
			tokenRevealCss,
		});
		const patchedSnapshot = readModel.applyPatch(tokenRevealEntries);

		expect(patchedSnapshot).not.toBeNull();
		if (patchedSnapshot === null) {
			return;
		}
		expect(patchedSnapshot.rows[0]).toBe(baseSnapshot.rows[0]);
		expect(patchedSnapshot.rows[1]).toMatchObject({
			type: "assistant_merged",
			tokenRevealCss,
		});
		expect(patchedSnapshot.entriesById.get("assistant-1")).toMatchObject({
			id: "assistant-1",
			tokenRevealCss,
		});
		const restoredSnapshot = readModel.applySnapshot(baseEntries);
		expect(restoredSnapshot.rows).toBe(baseSnapshot.rows);
		expect(restoredSnapshot.entriesById).toBe(baseSnapshot.entriesById);
		expect(restoredSnapshot.latestRowTimestampMs).toBe(baseSnapshot.latestRowTimestampMs);
	});

	it("applies display scene overlays through the patch path", () => {
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
			markdown: "",
			isStreaming: true,
			timestampMs: 20,
		};
		const baseEntries = [userEntry, assistantEntry];
		const baseSnapshot = readModel.applySnapshot(baseEntries);
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
					canonicalText: "Display text",
					displayText: "Display text",
					canonicalTextRevision: "1:assistant-1",
					isLiveTail: true,
				},
			],
			viewport: { hasLiveTail: true, requiresStableTailMount: true },
		};

		const displayedEntries = applyAgentPanelDisplayModelToSceneEntries(
			model,
			createAgentPanelDisplayMemory(),
			baseEntries
		);
		const patchedSnapshot = readModel.applyPatch(displayedEntries);

		expect(patchedSnapshot).not.toBeNull();
		if (patchedSnapshot === null) {
			return;
		}
		expect(patchedSnapshot.rows[0]).toBe(baseSnapshot.rows[0]);
		expect(patchedSnapshot.rows[1]).toMatchObject({
			type: "assistant_merged",
			markdown: "Display text",
		});
		expect(patchedSnapshot.entriesById.get("assistant-1")).toMatchObject({
			id: "assistant-1",
			markdown: "Display text",
		});
	});
});
