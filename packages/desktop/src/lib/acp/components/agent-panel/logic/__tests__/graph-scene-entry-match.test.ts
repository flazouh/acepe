import type { AgentPanelSceneEntryModel } from "@acepe/ui/agent-panel";
import { describe, expect, it } from "vitest";
import type { SessionEntry } from "../../../../application/dto/session-entry.js";
import {
	type AgentPanelDisplayModel,
	applyAgentPanelDisplayModelToSceneEntries,
	createAgentPanelDisplayMemory,
	getAgentPanelDisplayScenePatch,
} from "../agent-panel-display-model.js";
import {
	markAgentPanelSceneEntryArrayAppendPatch,
	markAgentPanelSceneEntryArrayPatch,
} from "../../../../session-state/agent-panel-scene-entry-array-patch.js";
import {
	createGraphSceneEntryIndex,
	createGraphSceneEntryIndexReadModel,
	findGraphSceneEntryForDisplayEntry,
} from "../graph-scene-entry-match.js";
import { createTokenRevealSceneReadModel } from "../token-reveal-scene-read-model.js";
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
		expect(readModel.selectEntryIndexById("tool-1")).toBe(0);
		expect(readModel.selectEntryIndexById("tool-2")).toBe(1);
		expect(readModel.selectEntryById(null)).toBeUndefined();
		expect(readModel.selectEntryIndexById(null)).toBeUndefined();
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
		const firstIndex = readModel.applySnapshot([firstEntry]);

		const nextIndex = readModel.applySnapshot([firstEntry, nextEntry]);

		expect(nextIndex).toBe(firstIndex);
		expect(nextIndex.get("tool-1")).toBe(firstEntry);
		expect(nextIndex.get("tool-2")).toBe(nextEntry);
		expect(readModel.selectEntryIndexById("tool-2")).toBe(1);
	});

	it("uses append-only updates when prior scene entries are fresh but content-stable", () => {
		const readModel = createGraphSceneEntryIndexReadModel();
		const firstIndex = readModel.applySnapshot([
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

		const nextIndex = readModel.applySnapshot([
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

	it("patches the index when an existing scene entry object changes", () => {
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
		const firstIndex = readModel.applySnapshot([firstEntry]);

		const nextIndex = readModel.applySnapshot([changedEntry]);

		expect(nextIndex).toBe(firstIndex);
		expect(nextIndex.get("tool-1")).toBe(changedEntry);
	});

	it("skips same-length index writes for content-equivalent scene entries", () => {
		const readModel = createGraphSceneEntryIndexReadModel();
		const firstEntry: AgentPanelSceneEntryModel = {
			id: "tool-1",
			type: "tool_call",
			title: "Run first command",
			status: "pending",
		};
		const firstIndex = readModel.applySnapshot([firstEntry]);
		const originalMapSet = Map.prototype.set;

		Map.prototype.set = function patchedMapSet<K, V>(this: Map<K, V>, key: K, value: V): Map<K, V> {
			if (
				typeof key === "string" &&
				key === "tool-1" &&
				typeof value === "object" &&
				value !== null &&
				"id" in value &&
				this.has("tool-1" as K)
			) {
				throw new Error("must not rewrite content-equivalent scene entries");
			}
			return originalMapSet.call(this, key, value);
		};

		try {
			const nextIndex = readModel.applySnapshot([
				{
					id: "tool-1",
					type: "tool_call",
					title: "Run first command",
					status: "pending",
				},
			]);

			expect(nextIndex).toBe(firstIndex);
			expect(nextIndex.get("tool-1")).toBe(firstEntry);
		} finally {
			Map.prototype.set = originalMapSet;
		}
	});

	it("patches stable middle insertions without rebuilding the graph entry index", () => {
		const readModel = createGraphSceneEntryIndexReadModel();
		const userEntry: AgentPanelSceneEntryModel = {
			id: "user-1",
			type: "user",
			text: "Prompt",
		};
		const interactionEntry: AgentPanelSceneEntryModel = {
			id: "interaction:question-1",
			type: "tool_call",
			title: "Question",
			status: "running",
		};
		const assistantEntry: AgentPanelSceneEntryModel = {
			id: "assistant-1",
			type: "assistant",
			markdown: "Answer",
		};
		const firstIndex = readModel.applySnapshot([userEntry, interactionEntry]);

		const nextIndex = readModel.applySnapshot([userEntry, assistantEntry, interactionEntry]);

		expect(nextIndex).toBe(firstIndex);
		expect(nextIndex.get("user-1")).toBe(userEntry);
		expect(nextIndex.get("assistant-1")).toBe(assistantEntry);
		expect(nextIndex.get("interaction:question-1")).toBe(interactionEntry);
		expect(readModel.selectEntryIndexById("assistant-1")).toBe(1);
		expect(readModel.selectEntryIndexById("interaction:question-1")).toBe(2);
	});

	it("patches and restores token reveal entries without rebuilding indexes", () => {
		const readModel = createGraphSceneEntryIndexReadModel();
		const tokenRevealReadModel = createTokenRevealSceneReadModel();
		const assistantEntry = {
			id: "assistant-1",
			type: "assistant",
			markdown: "Answer",
			isStreaming: true,
		} satisfies AgentPanelSceneEntryModel;
		const baseEntries = [assistantEntry];
		const baseIndex = readModel.applySnapshot(baseEntries);

		const patchedIndex = readModel.applySnapshot(
			tokenRevealReadModel.applySnapshot({
				sceneEntries: baseEntries,
				sourceEntry: assistantEntry,
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

		expect(patchedIndex).not.toBe(baseIndex);
		expect(patchedIndex.get("assistant-1")).toMatchObject({
			id: "assistant-1",
			tokenRevealCss: { revealCount: 1 },
		});
		expect(patchedIndex.size).toBe(baseIndex.size);
		expect([...patchedIndex.keys()]).toEqual(["assistant-1"]);
		expect([...patchedIndex.values()][0]).toMatchObject({
			id: "assistant-1",
			tokenRevealCss: { revealCount: 1 },
		});
		expect(readModel.selectEntryIndexById("assistant-1")).toBe(0);
		expect(readModel.applySnapshot(baseEntries)).toBe(baseIndex);
	});

	it("patches both reveal-target entries when the token reveal tail moves", () => {
		const readModel = createGraphSceneEntryIndexReadModel();
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
		const baseIndex = readModel.applySnapshot(baseEntries);

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

		const movedIndex = readModel.applySnapshot(
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

		expect(movedIndex).not.toBe(baseIndex);
		expect(movedIndex.get("assistant-1")).toBe(firstAssistantEntry);
		expect(movedIndex.get("assistant-2")).toMatchObject({
			id: "assistant-2",
			tokenRevealCss: { revealCount: 1 },
		});
		expect(readModel.selectEntryIndexById("assistant-1")).toBe(0);
		expect(readModel.selectEntryIndexById("assistant-2")).toBe(1);
	});

	it("overlays display-patched scene entries without rebuilding indexes", () => {
		const readModel = createGraphSceneEntryIndexReadModel();
		const assistantEntry = {
			id: "assistant-1",
			type: "assistant",
			markdown: "",
			isStreaming: true,
		} satisfies AgentPanelSceneEntryModel;
		const baseEntries = [assistantEntry];
		const baseIndex = readModel.applySnapshot(baseEntries);
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
					canonicalText: "Answer",
					displayText: "Answer",
					canonicalTextRevision: "1:assistant-1",
					isLiveTail: true,
				},
			],
			viewport: { hasLiveTail: true, requiresStableTailMount: true },
		};

		const patchedIndex = readModel.applySnapshot(
			applyAgentPanelDisplayModelToSceneEntries(
				model,
				createAgentPanelDisplayMemory(),
				baseEntries
			)
		);

		expect(patchedIndex).not.toBe(baseIndex);
		expect(patchedIndex.get("assistant-1")).toMatchObject({
			id: "assistant-1",
			markdown: "Answer",
		});
		expect(patchedIndex.size).toBe(baseIndex.size);
		expect([...patchedIndex.keys()]).toEqual(["assistant-1"]);
		expect(readModel.selectEntryIndexById("assistant-1")).toBe(0);
		expect(readModel.applySnapshot(baseEntries)).toBe(baseIndex);
	});

	it("indexes display-patched entries without mapping the patch list", () => {
		const readModel = createGraphSceneEntryIndexReadModel();
		const assistantEntry = {
			id: "assistant-1",
			type: "assistant",
			markdown: "",
			isStreaming: true,
		} satisfies AgentPanelSceneEntryModel;
		const baseEntries = [assistantEntry];
		readModel.applySnapshot(baseEntries);
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
					canonicalText: "Answer",
					displayText: "Answer",
					canonicalTextRevision: "1:assistant-1",
					isLiveTail: true,
				},
			],
			viewport: { hasLiveTail: true, requiresStableTailMount: true },
		};
		const patchedEntries = applyAgentPanelDisplayModelToSceneEntries(
			model,
			createAgentPanelDisplayMemory(),
			baseEntries
		);
		const patch = getAgentPanelDisplayScenePatch(patchedEntries);
		expect(patch).toBeDefined();
		expect(patch?.entriesByIndex.get(0)).toMatchObject({
			id: "assistant-1",
			markdown: "Answer",
		});
		const originalMap = patch?.entries.map;
		let originalPatchIterator: (() => IterableIterator<AgentPanelSceneEntryModel>) | undefined;
		if (patch !== undefined) {
			patch.entries.map = () => {
				throw new Error("must not map display patches while indexing scene entries");
			};
			originalPatchIterator = patch.entries[Symbol.iterator].bind(patch.entries);
			Object.defineProperty(patch.entries, Symbol.iterator, {
				configurable: true,
				value: () => {
					throw new Error("must not iterate display patch entries directly");
				},
			});
		}

		try {
			const patchedIndex = readModel.applySnapshot(patchedEntries);

			expect(patchedIndex.get("assistant-1")).toMatchObject({
				id: "assistant-1",
				markdown: "Answer",
			});
		} finally {
			if (patch !== undefined && originalMap !== undefined) {
				patch.entries.map = originalMap;
			}
			if (patch !== undefined && originalPatchIterator !== undefined) {
				Object.defineProperty(patch.entries, Symbol.iterator, {
					configurable: true,
					value: originalPatchIterator,
				});
			}
		}
	});

	it("applies marked scene patches over an overlay index without cloning the overlay", () => {
		const readModel = createGraphSceneEntryIndexReadModel();
		const assistantEntry = {
			id: "assistant-1",
			type: "assistant",
			markdown: "",
			isStreaming: true,
		} satisfies AgentPanelSceneEntryModel;
		const baseEntries = [assistantEntry];
		readModel.applySnapshot(baseEntries);
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
					canonicalText: "Answer",
					displayText: "Answer",
					canonicalTextRevision: "1:assistant-1",
					isLiveTail: true,
				},
			],
			viewport: { hasLiveTail: true, requiresStableTailMount: true },
		};
		const overlayIndex = readModel.applySnapshot(
			applyAgentPanelDisplayModelToSceneEntries(
				model,
				createAgentPanelDisplayMemory(),
				baseEntries
			)
		);
		const originalIterator = overlayIndex[Symbol.iterator];
		(overlayIndex as ReadonlyMap<string, AgentPanelSceneEntryModel> & Record<symbol, unknown>)[
			Symbol.iterator
		] = () => {
			throw new Error("must not clone overlay scene entry indexes");
		};
		const patchedEntry = {
			...assistantEntry,
			markdown: "Canonical answer",
		} satisfies AgentPanelSceneEntryModel;
		const patchedEntryList = [patchedEntry];
		const originalPatchedEntryListIterator = patchedEntryList[Symbol.iterator];
		patchedEntryList[Symbol.iterator] = () => {
			throw new Error("must use indexed scene entry patches");
		};
		const patchedEntries = [patchedEntry];
		markAgentPanelSceneEntryArrayPatch(patchedEntries, {
			baseSceneEntries: baseEntries,
			entries: patchedEntryList,
			entriesByIndex: new Map([[0, patchedEntry]]),
		});

		try {
			const patchedIndex = readModel.applyPatch(patchedEntries);

			expect(patchedIndex).not.toBeNull();
			if (patchedIndex === null) {
				return;
			}
			expect(patchedIndex).not.toBe(overlayIndex);
			expect(patchedIndex.get("assistant-1")).toBe(patchedEntry);
			expect(readModel.selectEntryIndexById("assistant-1")).toBe(0);
		} finally {
			(overlayIndex as ReadonlyMap<string, AgentPanelSceneEntryModel> & Record<symbol, unknown>)[
				Symbol.iterator
			] = originalIterator;
			patchedEntryList[Symbol.iterator] = originalPatchedEntryListIterator;
		}
	});

	it("does not treat unmarked scene entries as graph index patches", () => {
		const readModel = createGraphSceneEntryIndexReadModel();
		const entry = {
			id: "assistant-1",
			type: "assistant",
			markdown: "Answer",
		} satisfies AgentPanelSceneEntryModel;
		readModel.applySnapshot([entry]);

		expect(readModel.applyPatch([entry])).toBeNull();
	});

	it("applies marked appends over an overlay index without cloning the overlay", () => {
		const readModel = createGraphSceneEntryIndexReadModel();
		const assistantEntry = {
			id: "assistant-1",
			type: "assistant",
			markdown: "",
			isStreaming: true,
		} satisfies AgentPanelSceneEntryModel;
		const baseEntries = [assistantEntry];
		readModel.applySnapshot(baseEntries);
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
					canonicalText: "Answer",
					displayText: "Answer",
					canonicalTextRevision: "1:assistant-1",
					isLiveTail: true,
				},
			],
			viewport: { hasLiveTail: true, requiresStableTailMount: true },
		};
		const overlayIndex = readModel.applySnapshot(
			applyAgentPanelDisplayModelToSceneEntries(
				model,
				createAgentPanelDisplayMemory(),
				baseEntries
			)
		);
		const originalIterator = overlayIndex[Symbol.iterator];
		(overlayIndex as ReadonlyMap<string, AgentPanelSceneEntryModel> & Record<symbol, unknown>)[
			Symbol.iterator
		] = () => {
			throw new Error("must not clone overlay scene entry indexes for appends");
		};
		const appendedEntry = {
			id: "tool-1",
			type: "tool_call",
			title: "Run command",
			status: "done",
		} satisfies AgentPanelSceneEntryModel;
		const appendedEntries = [appendedEntry];
		const nextEntries = [assistantEntry, appendedEntry];
		markAgentPanelSceneEntryArrayAppendPatch(nextEntries, {
			baseSceneEntries: baseEntries,
			appendedEntries,
		});

		try {
			const appendedIndex = readModel.applyPatch(nextEntries);

			expect(appendedIndex).not.toBeNull();
			if (appendedIndex === null) {
				return;
			}
			expect(appendedIndex).not.toBe(overlayIndex);
			expect(appendedIndex.get("assistant-1")).toMatchObject({
				id: "assistant-1",
				markdown: "Answer",
			});
			expect(appendedIndex.get("tool-1")).toBe(appendedEntry);
			expect(readModel.selectEntryIndexById("tool-1")).toBe(1);
		} finally {
			(overlayIndex as ReadonlyMap<string, AgentPanelSceneEntryModel> & Record<symbol, unknown>)[
				Symbol.iterator
			] = originalIterator;
		}
	});
});
