import { describe, expect, it } from "vitest";
import type { AgentPanelSceneEntryModel } from "@acepe/ui/agent-panel";

import {
	buildTranscriptViewportRowsSummary,
	createTranscriptViewportRowsReadModel,
	inferTranscriptViewportRowsReason,
} from "../transcript-viewport-row-summary.js";
import { createSceneDisplayRowsReadModel } from "../scene-display-row-read-model.js";
import type { SceneDisplayRow } from "../scene-display-rows.js";
import { markAgentPanelSceneEntryArraySplicePatch } from "../../../../session-state/agent-panel-scene-entry-array-patch.js";

describe("createTranscriptViewportRowsReadModel", () => {
	it("selects base rows directly when no waiting row is needed", () => {
		const readModel = createTranscriptViewportRowsReadModel();
		const rows = [userRow("user-1"), assistantRow("assistant-1")];

		const selectedRows = readModel.selectRows({
			rows,
			waiting: { show: false },
		});

		expect(selectedRows).toBe(rows);
	});

	it("selects and caches rows with one waiting row appended", () => {
		const readModel = createTranscriptViewportRowsReadModel();
		const rows = [userRow("user-1"), assistantRow("assistant-1")];

		const selectedRows = readModel.selectRows({
			rows,
			waiting: {
				show: true,
				startedAtMs: 1_000,
				label: "Planning next moves...",
			},
		});

		expect(selectedRows).not.toBe(rows);
		expect(selectedRows.slice(0, 2)).toEqual(rows);
		expect(selectedRows[2]).toEqual({
			type: "thinking",
			id: "thinking-indicator",
			startedAtMs: 1_000,
			label: "Planning next moves...",
		});
		expect(
			readModel.selectRows({
				rows,
				waiting: {
					show: true,
					startedAtMs: 1_000,
					label: "Planning next moves...",
				},
			})
		).toBe(selectedRows);
	});

	it("selects a waiting row without iterating or copying base rows", () => {
		const readModel = createTranscriptViewportRowsReadModel();
		const rows = [userRow("user-1"), assistantRow("assistant-1")];
		const originalIterator = rows[Symbol.iterator];
		rows[Symbol.iterator] = () => {
			throw new Error("must not iterate base rows");
		};

		try {
			const selectedRows = readModel.selectRows({
				rows,
				waiting: {
					show: true,
					startedAtMs: 1_000,
					label: "Planning next moves...",
				},
			});

			expect(selectedRows).toHaveLength(3);
			expect(selectedRows[0]).toBe(rows[0]);
			expect(selectedRows[1]).toBe(rows[1]);
			expect(selectedRows[2]).toEqual({
				type: "thinking",
				id: "thinking-indicator",
				startedAtMs: 1_000,
				label: "Planning next moves...",
			});
		} finally {
			rows[Symbol.iterator] = originalIterator;
		}
	});

	it("keeps the selected summary stable for the same rows reference", () => {
		const readModel = createTranscriptViewportRowsReadModel();
		const rows = [userRow("user-1"), assistantRow("assistant-1")];

		const summary = readModel.applyRows({ rows, reason: "rows-updated" });

		expect(readModel.applyRows({ rows, reason: "rows-updated" })).toBe(summary);
		expect(readModel.selectSummary()).toBe(summary);
	});

	it("classifies waiting rows, streaming tails, and settled rows without component guesses", () => {
		expect(
			inferTranscriptViewportRowsReason({
				rows: [userRow("user-1")],
				isWaitingForResponse: true,
			})
		).toBe("waiting-row-appended");

		expect(
			inferTranscriptViewportRowsReason({
				rows: [assistantRow("assistant-1", { isStreaming: true })],
				isWaitingForResponse: false,
			})
		).toBe("streaming-growth");

		expect(
			inferTranscriptViewportRowsReason({
				rows: [assistantRow("assistant-1")],
				isWaitingForResponse: false,
			})
		).toBe("rows-updated");
	});

	it("keeps the summary stable for same-length patches that do not change viewport facts", () => {
		const displayRows = createSceneDisplayRowsReadModel();
		const readModel = createTranscriptViewportRowsReadModel();
		const userEntry = {
			type: "user",
			id: "user-1",
			text: "Prompt",
			isOptimistic: false,
		} satisfies AgentPanelSceneEntryModel;
		const toolEntry = {
			type: "tool_call",
			id: "tool-1",
			title: "Run",
			status: "running",
		} satisfies AgentPanelSceneEntryModel;
		const firstRows = displayRows.applySnapshot([userEntry, toolEntry]);
		const firstSummary = readModel.applyRows({
			rows: firstRows,
			reason: "rows-updated",
		});
		const patchedRows = displayRows.applySnapshot([
			userEntry,
			{ ...toolEntry, status: "done" },
		]);

		const patchedSummary = readModel.applyRows({
			rows: patchedRows,
			reason: "rows-updated",
		});

		expect(patchedSummary).toBe(firstSummary);
	});

	it("updates append-only rows without rebuilding existing anchor keys", () => {
		const readModel = createTranscriptViewportRowsReadModel();
		const firstRows = [userRow("user-1"), assistantRow("assistant-1")];
		const firstSummary = readModel.applyRows({
			rows: firstRows,
			reason: "rows-updated",
		});
		const nextRows = firstRows.concat(toolRow("tool-1"));

		const nextSummary = readModel.applyRows({
			rows: nextRows,
			reason: "rows-updated",
		});

		expect(nextSummary).not.toBe(firstSummary);
		expect(nextSummary.count).toBe(3);
		expect(nextSummary.firstKey).toBe("user-1");
		expect(nextSummary.lastKey).toBe("tool-1");
		expect(nextSummary.latestUserKey).toBe("user-1");
		expect(nextSummary.rowKeys).toEqual(["user-1", "assistant-1", "tool-1"]);
		expect(nextSummary.rowIndexByKey?.get("user-1")).toBe(0);
		expect(nextSummary.rowIndexByKey?.get("assistant-1")).toBe(1);
		expect(nextSummary.rowIndexByKey?.get("tool-1")).toBe(2);
		expect(nextSummary.anchorEligibleKeys).toEqual(["user-1", "assistant-1", "tool-1"]);
		expect(nextSummary.hasToolCallEntry).toBe(true);
	});

	it("uses scene display append metadata without comparing the row prefix", () => {
		const displayRows = createSceneDisplayRowsReadModel();
		const readModel = createTranscriptViewportRowsReadModel();
		const userEntry = {
			type: "user",
			id: "user-1",
			text: "Prompt",
			isOptimistic: false,
		} satisfies AgentPanelSceneEntryModel;
		const assistantEntry = {
			type: "assistant",
			id: "assistant-1",
			markdown: "Answer",
			isStreaming: false,
		} satisfies AgentPanelSceneEntryModel;
		const toolEntry = {
			type: "tool_call",
			id: "tool-1",
			title: "Run",
			status: "done",
		} satisfies AgentPanelSceneEntryModel;
		const firstRows = displayRows.applySnapshot([userEntry, assistantEntry]);
		readModel.applyRows({
			rows: firstRows,
			reason: "rows-updated",
		});
		const nextRows = displayRows.applySnapshot([userEntry, assistantEntry, toolEntry]);
		const originalFirstRow = firstRows[0];
		Object.defineProperty(firstRows, "0", {
			configurable: true,
			get() {
				throw new Error("must not compare previous row prefixes for display row appends");
			},
		});

		try {
			const nextSummary = readModel.applyRows({
				rows: nextRows,
				reason: "rows-updated",
			});

			expect(nextSummary.count).toBe(3);
			expect(nextSummary.rowKeys).toEqual(["user-1", "assistant-1", "tool-1"]);
			expect(nextSummary.rowIndexByKey?.get("tool-1")).toBe(2);
			expect(nextSummary.changedRange).toBeUndefined();
		} finally {
			Object.defineProperty(firstRows, "0", {
				configurable: true,
				writable: true,
				value: originalFirstRow,
			});
		}
	});

	it("updates append-only row keys without copying previous key arrays", () => {
		const readModel = createTranscriptViewportRowsReadModel();
		const firstRows = [userRow("user-1"), assistantRow("assistant-1")];
		const firstSummary = readModel.applyRows({
			rows: firstRows,
			reason: "rows-updated",
		});
		const rowKeysSlice = firstSummary.rowKeys?.slice;
		const anchorKeysSlice = firstSummary.anchorEligibleKeys.slice;
		if (firstSummary.rowKeys !== undefined) {
			firstSummary.rowKeys.slice = () => {
				throw new Error("must not copy previous row keys");
			};
		}
		firstSummary.anchorEligibleKeys.slice = () => {
			throw new Error("must not copy previous anchor keys");
		};

		try {
			const nextSummary = readModel.applyRows({
				rows: firstRows.concat(toolRow("tool-1")),
				reason: "rows-updated",
			});

			expect(nextSummary.rowKeys).toEqual(["user-1", "assistant-1", "tool-1"]);
			expect(nextSummary.anchorEligibleKeys).toEqual(["user-1", "assistant-1", "tool-1"]);
			expect(nextSummary.rowKeys?.[0]).toBe("user-1");
			expect(nextSummary.rowKeys?.[2]).toBe("tool-1");
		} finally {
			if (firstSummary.rowKeys !== undefined && rowKeysSlice !== undefined) {
				firstSummary.rowKeys.slice = rowKeysSlice;
			}
			firstSummary.anchorEligibleKeys.slice = anchorKeysSlice;
		}
	});

	it("updates append-only row indexes without cloning the previous index", () => {
		const readModel = createTranscriptViewportRowsReadModel();
		const firstRows = [userRow("user-1"), assistantRow("assistant-1")];
		const firstSummary = readModel.applyRows({
			rows: firstRows,
			reason: "rows-updated",
		});
		const rowIndexByKey = firstSummary.rowIndexByKey as
			| (ReadonlyMap<string, number> & Record<symbol, unknown>)
			| undefined;
		const originalIterator = rowIndexByKey?.[Symbol.iterator];
		if (rowIndexByKey !== undefined) {
			rowIndexByKey[Symbol.iterator] = () => {
				throw new Error("must not clone previous row index");
			};
		}

		try {
			const nextSummary = readModel.applyRows({
				rows: firstRows.concat(toolRow("tool-1")),
				reason: "rows-updated",
			});

			expect(nextSummary.rowIndexByKey?.get("user-1")).toBe(0);
			expect(nextSummary.rowIndexByKey?.get("assistant-1")).toBe(1);
			expect(nextSummary.rowIndexByKey?.get("tool-1")).toBe(2);
		} finally {
			if (rowIndexByKey !== undefined && originalIterator !== undefined) {
				rowIndexByKey[Symbol.iterator] = originalIterator;
			}
		}
	});

	it("handles a waiting row append without changing anchor keys", () => {
		const readModel = createTranscriptViewportRowsReadModel();
		const firstRows = [userRow("user-1"), assistantRow("assistant-1")];
		const firstSummary = readModel.applyRows({
			rows: firstRows,
			reason: "rows-updated",
		});

		const waitingSummary = readModel.applyRows({
			rows: firstRows.concat(thinkingRow("Working")),
			reason: "waiting-row-appended",
		});

		expect(waitingSummary.lastKey).toBe("thinking-indicator");
		expect(waitingSummary.latestUserKey).toBe("user-1");
		expect(waitingSummary.rowKeys).toEqual(["user-1", "assistant-1", "thinking-indicator"]);
		expect(waitingSummary.anchorEligibleKeys).toBe(firstSummary.anchorEligibleKeys);
	});

	it("applies a waiting row append without checking the whole row prefix", () => {
		const readModel = createTranscriptViewportRowsReadModel();
		const firstRows = [userRow("user-1"), assistantRow("assistant-1")];
		readModel.applyRows({
			rows: firstRows,
			reason: "rows-updated",
		});
		const selectedRows = readModel.selectRows({
			rows: firstRows,
			waiting: {
				show: true,
				startedAtMs: 1_000,
				label: "Planning next moves...",
			},
		});
		const originalFirstRow = firstRows[0];
		Object.defineProperty(firstRows, "0", {
			configurable: true,
			get() {
				throw new Error("must not compare every previous row");
			},
		});

		try {
			const waitingSummary = readModel.applyRows({
				rows: selectedRows,
				reason: "waiting-row-appended",
			});

			expect(waitingSummary.lastKey).toBe("thinking-indicator");
			expect(waitingSummary.rowKeys).toEqual([
				"user-1",
				"assistant-1",
				"thinking-indicator",
			]);
		} finally {
			Object.defineProperty(firstRows, "0", {
				configurable: true,
				writable: true,
				value: originalFirstRow,
			});
		}
	});

	it("updates a replaced tail row from the previous summary", () => {
		const displayRows = createSceneDisplayRowsReadModel();
		const readModel = createTranscriptViewportRowsReadModel();
		const firstUserEntry = {
			type: "user",
			id: "user-1",
			text: "Prompt 1",
			isOptimistic: false,
		} satisfies AgentPanelSceneEntryModel;
		const secondUserEntry = {
			type: "user",
			id: "user-2",
			text: "Prompt 2",
			isOptimistic: false,
		} satisfies AgentPanelSceneEntryModel;
		const assistantEntry = {
			type: "assistant",
			id: "assistant-1",
			markdown: "Answer",
			isStreaming: false,
		} satisfies AgentPanelSceneEntryModel;
		const firstRows = displayRows.applySnapshot([firstUserEntry, secondUserEntry]);
		const firstSummary = readModel.applyRows({
			rows: firstRows,
			reason: "rows-updated",
		});
		const nextRows = displayRows.applySnapshot([firstUserEntry, assistantEntry]);

		const nextSummary = readModel.applyRows({
			rows: nextRows,
			reason: "rows-updated",
		});

		expect(nextSummary.count).toBe(2);
		expect(nextSummary.firstKey).toBe("user-1");
		expect(nextSummary.lastKey).toBe("assistant-1");
		expect(nextSummary.latestUserKey).toBe("user-1");
		expect(nextSummary.rowKeys).toEqual(["user-1", "assistant-1"]);
		expect(nextSummary.anchorEligibleKeys).toEqual(["user-1", "assistant-1"]);
		expect(nextSummary.anchorEligibleKeys).not.toBe(firstSummary.anchorEligibleKeys);
	});

	it("updates replaced tail keys without copying previous key arrays", () => {
		const readModel = createTranscriptViewportRowsReadModel();
		const firstRows = [userRow("user-1"), assistantRow("assistant-1")];
		const firstSummary = readModel.applyRows({
			rows: firstRows,
			reason: "rows-updated",
		});
		const rowKeysSlice = firstSummary.rowKeys?.slice;
		const rowKeysConcat = firstSummary.rowKeys?.concat;
		const anchorKeysSlice = firstSummary.anchorEligibleKeys.slice;
		const anchorKeysConcat = firstSummary.anchorEligibleKeys.concat;
		if (firstSummary.rowKeys !== undefined) {
			firstSummary.rowKeys.slice = () => {
				throw new Error("must not copy previous row keys");
			};
			firstSummary.rowKeys.concat = () => {
				throw new Error("must not concatenate previous row keys");
			};
		}
		firstSummary.anchorEligibleKeys.slice = () => {
			throw new Error("must not copy previous anchor keys");
		};
		firstSummary.anchorEligibleKeys.concat = () => {
			throw new Error("must not concatenate previous anchor keys");
		};

		try {
			const nextSummary = readModel.applyRows({
				rows: [firstRows[0]!, assistantRow("assistant-2")],
				reason: "rows-updated",
			});

			expect(nextSummary.rowKeys).toEqual(["user-1", "assistant-2"]);
			expect(nextSummary.anchorEligibleKeys).toEqual(["user-1", "assistant-2"]);
			expect(nextSummary.rowKeys?.[0]).toBe("user-1");
			expect(nextSummary.rowKeys?.[1]).toBe("assistant-2");
		} finally {
			if (firstSummary.rowKeys !== undefined) {
				if (rowKeysSlice !== undefined) {
					firstSummary.rowKeys.slice = rowKeysSlice;
				}
				if (rowKeysConcat !== undefined) {
					firstSummary.rowKeys.concat = rowKeysConcat;
				}
			}
			firstSummary.anchorEligibleKeys.slice = anchorKeysSlice;
			firstSummary.anchorEligibleKeys.concat = anchorKeysConcat;
		}
	});

	it("updates replaced tail row indexes without cloning the previous index", () => {
		const readModel = createTranscriptViewportRowsReadModel();
		const firstRows = [userRow("user-1"), assistantRow("assistant-1")];
		const firstSummary = readModel.applyRows({
			rows: firstRows,
			reason: "rows-updated",
		});
		const rowIndexByKey = firstSummary.rowIndexByKey as
			| (ReadonlyMap<string, number> & Record<symbol, unknown>)
			| undefined;
		const originalIterator = rowIndexByKey?.[Symbol.iterator];
		if (rowIndexByKey !== undefined) {
			rowIndexByKey[Symbol.iterator] = () => {
				throw new Error("must not clone previous row index for tail replacement");
			};
		}

		try {
			const nextSummary = readModel.applyRows({
				rows: [firstRows[0]!, assistantRow("assistant-2")],
				reason: "rows-updated",
			});

			expect(nextSummary.rowIndexByKey?.get("user-1")).toBe(0);
			expect(nextSummary.rowIndexByKey?.get("assistant-1")).toBeUndefined();
			expect(nextSummary.rowIndexByKey?.get("assistant-2")).toBe(1);
		} finally {
			if (rowIndexByKey !== undefined && originalIterator !== undefined) {
				rowIndexByKey[Symbol.iterator] = originalIterator;
			}
		}
	});

	it("updates same-key patched display rows without scanning unchanged row prefixes", () => {
		const displayRows = createSceneDisplayRowsReadModel();
		const readModel = createTranscriptViewportRowsReadModel();
		const userEntry = {
			type: "user",
			id: "user-1",
			text: "Prompt",
			isOptimistic: false,
		} satisfies AgentPanelSceneEntryModel;
		const assistantEntry = {
			type: "assistant",
			id: "assistant-1",
			markdown: "Answer",
			isStreaming: false,
		} satisfies AgentPanelSceneEntryModel;
		const firstToolEntry = {
			type: "tool_call",
			id: "tool-1",
			title: "Run",
			status: "running",
		} satisfies AgentPanelSceneEntryModel;
		const firstRows = displayRows.applySnapshot([userEntry, assistantEntry, firstToolEntry]);
		const firstSummary = readModel.applyRows({
			rows: firstRows,
			reason: "rows-updated",
		});
		const nextRows = displayRows.applySnapshot([
			userEntry,
			assistantEntry,
			{ ...firstToolEntry, status: "done" },
		]);
		const originalFirstRow = firstRows[0];
		Object.defineProperty(firstRows, "0", {
			configurable: true,
			get() {
				throw new Error("must not scan unchanged viewport rows");
			},
		});

		try {
			const nextSummary = readModel.applyRows({
				rows: nextRows,
				reason: "rows-updated",
			});

			expect(nextSummary).toBe(firstSummary);
		} finally {
			Object.defineProperty(firstRows, "0", {
				configurable: true,
				writable: true,
				value: originalFirstRow,
			});
		}
	});

	it("applies scene display row insertions without scanning unchanged row prefixes", () => {
		const displayRows = createSceneDisplayRowsReadModel();
		const readModel = createTranscriptViewportRowsReadModel();
		const userEntry = {
			type: "user",
			id: "user-1",
			text: "Prompt",
			isOptimistic: false,
		} satisfies AgentPanelSceneEntryModel;
		const assistantEntry = {
			type: "assistant",
			id: "assistant-1",
			markdown: "Answer",
			isStreaming: false,
		} satisfies AgentPanelSceneEntryModel;
		const toolEntry = {
			type: "tool_call",
			id: "tool-1",
			title: "Run",
			status: "running",
		} satisfies AgentPanelSceneEntryModel;
		const firstRows = displayRows.applySnapshot([userEntry, toolEntry]);
		readModel.applyRows({
			rows: firstRows,
			reason: "rows-updated",
		});
		const nextRows = displayRows.applySnapshot([userEntry, assistantEntry, toolEntry]);
		const originalFirstRow = firstRows[0];
		Object.defineProperty(firstRows, "0", {
			configurable: true,
			get() {
				throw new Error("must not scan unchanged viewport rows for insertion");
			},
		});

		try {
			const nextSummary = readModel.applyRows({
				rows: nextRows,
				reason: "rows-updated",
			});

			expect(nextSummary.count).toBe(3);
			expect(nextSummary.rowKeys).toEqual(["user-1", "assistant-1", "tool-1"]);
			expect(nextSummary.rowIndexByKey?.get("user-1")).toBe(0);
			expect(nextSummary.rowIndexByKey?.get("assistant-1")).toBe(1);
			expect(nextSummary.rowIndexByKey?.get("tool-1")).toBe(2);
			expect(nextSummary.changedRange).toEqual({ startIndex: 1, endIndex: 2 });
		} finally {
			Object.defineProperty(firstRows, "0", {
				configurable: true,
				writable: true,
				value: originalFirstRow,
			});
		}
	});

	it("updates tail-derived boolean facts without losing earlier matches", () => {
		const readModel = createTranscriptViewportRowsReadModel();
		const firstRows = [toolRow("tool-1"), assistantRow("assistant-1", { tokenReveal: true })];
		readModel.applyRows({
			rows: firstRows,
			reason: "rows-updated",
		});

		const nextSummary = readModel.applyRows({
			rows: [firstRows[0]!, assistantRow("assistant-2")],
			reason: "rows-updated",
		});

		expect(nextSummary.hasToolCallEntry).toBe(true);
		expect(nextSummary.hasTokenRevealAssistantEntry).toBe(false);
		expect(nextSummary.hasLiveAssistantDisplayEntry).toBe(false);
	});

	it("truncates same-prefix rows without rebuilding from all rows", () => {
		const readModel = createTranscriptViewportRowsReadModel();
		const firstRows = [
			userRow("user-1"),
			assistantRow("assistant-1", { tokenReveal: true }),
			toolRow("tool-1"),
		];
		const firstSummary = readModel.applyRows({
			rows: firstRows,
			reason: "rows-updated",
		});
		const nextRows = firstRows.slice(0, 2);

		const nextSummary = readModel.applyRows({
			rows: nextRows,
			reason: "rows-updated",
		});

		expect(nextSummary.count).toBe(2);
		expect(nextSummary.firstKey).toBe("user-1");
		expect(nextSummary.lastKey).toBe("assistant-1");
		expect(nextSummary.latestUserKey).toBe("user-1");
		expect(nextSummary.rowKeys).toEqual(["user-1", "assistant-1"]);
		expect(Array.from(nextSummary.rowIndexByKey?.entries() ?? [])).toEqual([
			["user-1", 0],
			["assistant-1", 1],
		]);
		expect(nextSummary.anchorEligibleKeys).toEqual(["user-1", "assistant-1"]);
		expect(nextSummary.hasToolCallEntry).toBe(false);
		expect(nextSummary.hasTokenRevealAssistantEntry).toBe(true);
		expect(nextSummary.hasLiveAssistantDisplayEntry).toBe(true);
		expect(nextSummary).not.toBe(firstSummary);
	});

	it("truncates same-prefix row keys without copying previous arrays", () => {
		const readModel = createTranscriptViewportRowsReadModel();
		const firstRows = [
			userRow("user-1"),
			assistantRow("assistant-1"),
			toolRow("tool-1"),
		];
		const firstSummary = readModel.applyRows({
			rows: firstRows,
			reason: "rows-updated",
		});
		const nextRows = firstRows.slice(0, 2);
		const previousRowsSlice = firstRows.slice;
		const rowKeysSlice = firstSummary.rowKeys?.slice;
		const anchorKeysSlice = firstSummary.anchorEligibleKeys.slice;
		firstRows.slice = () => {
			throw new Error("must not copy previous rows");
		};
		if (firstSummary.rowKeys !== undefined) {
			firstSummary.rowKeys.slice = () => {
				throw new Error("must not copy previous row keys");
			};
		}
		firstSummary.anchorEligibleKeys.slice = () => {
			throw new Error("must not copy previous anchor keys");
		};

		try {
			const nextSummary = readModel.applyRows({
				rows: nextRows,
				reason: "rows-updated",
			});

			expect(nextSummary.rowKeys).toEqual(["user-1", "assistant-1"]);
			expect(nextSummary.anchorEligibleKeys).toEqual(["user-1", "assistant-1"]);
			expect(nextSummary.rowKeys?.[0]).toBe("user-1");
			expect(nextSummary.rowKeys?.[1]).toBe("assistant-1");
		} finally {
			firstRows.slice = previousRowsSlice;
			if (firstSummary.rowKeys !== undefined && rowKeysSlice !== undefined) {
				firstSummary.rowKeys.slice = rowKeysSlice;
			}
			firstSummary.anchorEligibleKeys.slice = anchorKeysSlice;
		}
	});

	it("truncates same-prefix row indexes without cloning the previous index", () => {
		const readModel = createTranscriptViewportRowsReadModel();
		const firstRows = [
			userRow("user-1"),
			assistantRow("assistant-1"),
			toolRow("tool-1"),
		];
		const firstSummary = readModel.applyRows({
			rows: firstRows,
			reason: "rows-updated",
		});
		const rowIndexByKey = firstSummary.rowIndexByKey as
			| (ReadonlyMap<string, number> & Record<symbol, unknown>)
			| undefined;
		const originalIterator = rowIndexByKey?.[Symbol.iterator];
		if (rowIndexByKey !== undefined) {
			rowIndexByKey[Symbol.iterator] = () => {
				throw new Error("must not clone previous row index for truncation");
			};
		}

		try {
			const nextSummary = readModel.applyRows({
				rows: firstRows.slice(0, 2),
				reason: "rows-updated",
			});

			expect(nextSummary.rowIndexByKey?.get("user-1")).toBe(0);
			expect(nextSummary.rowIndexByKey?.get("assistant-1")).toBe(1);
			expect(nextSummary.rowIndexByKey?.get("tool-1")).toBeUndefined();
		} finally {
			if (rowIndexByKey !== undefined && originalIterator !== undefined) {
				rowIndexByKey[Symbol.iterator] = originalIterator;
			}
		}
	});

	it("truncates boolean facts without rescanning kept rows", () => {
		const readModel = createTranscriptViewportRowsReadModel();
		const firstRows = [
			userRow("user-1"),
			assistantRow("assistant-1", { isStreaming: true }),
			toolRow("tool-1"),
		];
		readModel.applyRows({
			rows: firstRows,
			reason: "rows-updated",
		});
		const nextRows = firstRows.slice(0, 2);
		const originalSome = nextRows.some;
		nextRows.some = () => {
			throw new Error("must not rescan kept rows to recompute truncation boolean facts");
		};

		try {
			const nextSummary = readModel.applyRows({
				rows: nextRows,
				reason: "rows-updated",
			});

			expect(nextSummary.hasToolCallEntry).toBe(false);
			expect(nextSummary.hasLiveAssistantDisplayEntry).toBe(true);
			expect(nextSummary.hasTokenRevealAssistantEntry).toBe(false);
		} finally {
			nextRows.some = originalSome;
		}
	});

	it("keeps earlier matching truncation facts when a later matching suffix row is removed", () => {
		const readModel = createTranscriptViewportRowsReadModel();
		const firstRows = [
			assistantRow("assistant-1", { isStreaming: true }),
			userRow("user-1"),
			assistantRow("assistant-2", { isStreaming: true }),
			toolRow("tool-1"),
		];
		readModel.applyRows({
			rows: firstRows,
			reason: "rows-updated",
		});

		const nextSummary = readModel.applyRows({
			rows: firstRows.slice(0, 2),
			reason: "rows-updated",
		});

		expect(nextSummary.hasLiveAssistantDisplayEntry).toBe(true);
		expect(nextSummary.lastLiveAssistantDisplayEntryIndex).toBe(0);
		expect(nextSummary.hasToolCallEntry).toBe(false);
	});

	it("applies scene display row truncation metadata without checking the whole row prefix", () => {
		const displayRows = createSceneDisplayRowsReadModel();
		const readModel = createTranscriptViewportRowsReadModel();
		const firstRows = displayRows.applySnapshot([
			{ id: "user-1", type: "user", text: "Prompt" },
			{ id: "missing-1", type: "missing", diagnosticLabel: "missing-1" },
		]);
		readModel.applyRows({
			rows: firstRows,
			reason: "rows-updated",
		});
		const nextRows = displayRows.applySnapshot([
			{ id: "user-1", type: "user", text: "Prompt" },
		]);
		const originalFirstRow = firstRows[0];
		Object.defineProperty(firstRows, "0", {
			configurable: true,
			get() {
				throw new Error("must not compare every previous row for metadata truncation");
			},
		});

		try {
			const nextSummary = readModel.applyRows({
				rows: nextRows,
				reason: "rows-updated",
			});

			expect(nextSummary.count).toBe(1);
			expect(nextSummary.lastKey).toBe("user-1");
			expect(nextSummary.rowIndexByKey?.get("user-1")).toBe(0);
			expect(nextSummary.rowIndexByKey?.get("missing-1")).toBeUndefined();
		} finally {
			Object.defineProperty(firstRows, "0", {
				configurable: true,
				writable: true,
				value: originalFirstRow,
			});
		}
	});

	it("applies scene display row splice metadata without checking the whole row prefix", () => {
		const displayRows = createSceneDisplayRowsReadModel();
		const readModel = createTranscriptViewportRowsReadModel();
		const userEntry: AgentPanelSceneEntryModel = {
			id: "user-1",
			type: "user",
			text: "Prompt",
		};
		const stableToolEntry: AgentPanelSceneEntryModel = {
			id: "tool-0",
			type: "tool_call",
			title: "Stable tool",
			status: "done",
		};
		const oldAssistantEntry: AgentPanelSceneEntryModel = {
			id: "assistant-1",
			type: "assistant",
			markdown: "Old",
		};
		const nextAssistantEntry: AgentPanelSceneEntryModel = {
			id: "assistant-2",
			type: "assistant",
			markdown: "Next",
			isStreaming: true,
		};
		const baseEntries: AgentPanelSceneEntryModel[] = [
			userEntry,
			stableToolEntry,
			oldAssistantEntry,
		];
		const firstRows = displayRows.applySnapshot(baseEntries);
		readModel.applyRows({
			rows: firstRows,
			reason: "rows-updated",
		});
		const nextEntries = [userEntry, stableToolEntry, nextAssistantEntry];
		markAgentPanelSceneEntryArraySplicePatch(nextEntries, {
			baseSceneEntries: baseEntries,
			startIndex: 2,
			insertedEntries: [nextAssistantEntry],
			trailingEntries: [],
		});
		const nextRows = displayRows.applyPatch(nextEntries);
		expect(nextRows).not.toBeNull();
		if (nextRows === null) {
			return;
		}
		const originalFirstRow = firstRows[0];
		Object.defineProperty(firstRows, "0", {
			configurable: true,
			get() {
				throw new Error("must not compare every previous row for metadata splice");
			},
		});

		try {
			const nextSummary = readModel.applyRows({
				rows: nextRows,
				reason: "rows-updated",
			});

			expect(nextSummary.count).toBe(3);
			expect(nextSummary.rowKeys).toEqual(["user-1", "tool-0", "assistant-2"]);
			expect(nextSummary.lastKey).toBe("assistant-2");
			expect(nextSummary.rowIndexByKey?.get("user-1")).toBe(0);
			expect(nextSummary.rowIndexByKey?.get("tool-0")).toBe(1);
			expect(nextSummary.rowIndexByKey?.get("assistant-2")).toBe(2);
			expect(nextSummary.rowIndexByKey?.get("assistant-1")).toBeUndefined();
			expect(nextSummary.hasLiveAssistantDisplayEntry).toBe(true);
			expect(nextSummary.lastLiveAssistantDisplayEntryIndex).toBe(2);
		} finally {
			Object.defineProperty(firstRows, "0", {
				configurable: true,
				writable: true,
				value: originalFirstRow,
			});
		}
	});

	it("applies same-length suffix replacement splice metadata without checking the whole row prefix", () => {
		const displayRows = createSceneDisplayRowsReadModel();
		const readModel = createTranscriptViewportRowsReadModel();
		const baseEntries: AgentPanelSceneEntryModel[] = [
			{ id: "user-0", type: "user", text: "Earlier prefix" },
			{ id: "user-1", type: "user", text: "Prompt" },
			{ id: "tool-1", type: "tool_call", title: "Old tool", status: "running" },
			{ id: "user-2", type: "user", text: "Follow-up" },
		];
		const firstRows = displayRows.applySnapshot(baseEntries);
		readModel.applyRows({
			rows: firstRows,
			reason: "rows-updated",
		});

		const nextRows = displayRows.applySnapshot([
			{ id: "user-0", type: "user", text: "Earlier prefix" },
			{ id: "user-1", type: "user", text: "Prompt" },
			{ id: "assistant-1", type: "assistant", markdown: "Replacement", isStreaming: true },
			{ id: "tool-2", type: "tool_call", title: "New tool", status: "done" },
		]);
		const originalFirstRow = firstRows[0];
		Object.defineProperty(firstRows, "0", {
			configurable: true,
			get() {
				throw new Error(
					"must not compare every previous row for same-length suffix replacement metadata"
				);
			},
		});

		try {
			const nextSummary = readModel.applyRows({
				rows: nextRows,
				reason: "rows-updated",
			});

			expect(nextSummary.count).toBe(4);
			expect(nextSummary.rowKeys).toEqual(["user-0", "user-1", "assistant-1", "tool-2"]);
			expect(nextSummary.rowIndexByKey?.get("user-0")).toBe(0);
			expect(nextSummary.rowIndexByKey?.get("user-1")).toBe(1);
			expect(nextSummary.rowIndexByKey?.get("assistant-1")).toBe(2);
			expect(nextSummary.rowIndexByKey?.get("tool-2")).toBe(3);
			expect(nextSummary.rowIndexByKey?.get("tool-1")).toBeUndefined();
			expect(nextSummary.rowIndexByKey?.get("user-2")).toBeUndefined();
			expect(nextSummary.hasLiveAssistantDisplayEntry).toBe(true);
			expect(nextSummary.lastLiveAssistantDisplayEntryIndex).toBe(2);
			expect(nextSummary.hasToolCallEntry).toBe(true);
			expect(nextSummary.lastToolCallEntryIndex).toBe(3);
		} finally {
			Object.defineProperty(firstRows, "0", {
				configurable: true,
				writable: true,
				value: originalFirstRow,
			});
		}
	});

	it("updates thinking durations after truncating the following timed row", () => {
		const readModel = createTranscriptViewportRowsReadModel();
		const startedAtMs = Date.parse("2026-01-01T00:00:00.000Z");
		const firstRows = [
			assistantRow("assistant-1", { thought: true, timestampMs: startedAtMs }),
			userRow("user-2", { timestampMs: startedAtMs + 4_000 }),
		];
		readModel.applyRows({
			rows: firstRows,
			reason: "rows-updated",
		});

		expect(readModel.selectThinkingDurationMs(0, startedAtMs + 10_000)).toBe(4_000);

		readModel.applyRows({
			rows: firstRows.slice(0, 1),
			reason: "rows-updated",
		});

		expect(readModel.selectThinkingDurationMs(0, startedAtMs + 10_000)).toBeNull();
	});

	it("selects fixed thinking durations from the next timed row", () => {
		const readModel = createTranscriptViewportRowsReadModel();
		const startedAtMs = Date.parse("2026-01-01T00:00:00.000Z");
		readModel.applyRows({
			rows: [
				assistantRow("assistant-1", { thought: true, timestampMs: startedAtMs }),
				userRow("user-2", { timestampMs: startedAtMs + 4_000 }),
			],
			reason: "rows-updated",
		});

		expect(readModel.selectThinkingDurationMs(0, startedAtMs + 30_000)).toBe(4_000);
		expect(readModel.selectThinkingDurationMs(1, startedAtMs + 30_000)).toBeNull();
	});

	it("builds initial thinking durations without repeatedly scanning row suffixes", () => {
		const readModel = createTranscriptViewportRowsReadModel();
		const startedAtMs = Date.parse("2026-01-01T00:00:00.000Z");
		const rawRows: SceneDisplayRow[] = [];
		for (let group = 0; group < 60; group += 1) {
			rawRows.push(
				assistantRow(`assistant-${group}`, {
					thought: true,
					timestampMs: startedAtMs + group * 1_000,
				})
			);
			for (let gap = 0; gap < 30; gap += 1) {
				rawRows.push(missingRow(`missing-${group}-${gap}`));
			}
		}
		rawRows.push(userRow("user-final", { timestampMs: startedAtMs + 60_000 }));
		const rows = rawRows.slice();
		let rowReads = 0;
		for (let index = 0; index < rawRows.length; index += 1) {
			Object.defineProperty(rows, String(index), {
				configurable: true,
				get() {
					rowReads += 1;
					return rawRows[index];
				},
			});
		}

		readModel.applyRows({ rows, reason: "rows-updated" });

		expect(readModel.selectThinkingDurationMs(0, startedAtMs + 90_000)).toBe(1_000);
		expect(rowReads).toBeLessThan(rawRows.length * 3);
	});

	it("updates thinking duration sources incrementally after an append", () => {
		const readModel = createTranscriptViewportRowsReadModel();
		const startedAtMs = Date.parse("2026-01-01T00:00:00.000Z");
		const firstRows = [assistantRow("assistant-1", { thought: true, timestampMs: startedAtMs })];
		readModel.applyRows({
			rows: firstRows,
			reason: "rows-updated",
		});

		expect(readModel.selectThinkingDurationMs(0, startedAtMs + 10_000)).toBeNull();

		readModel.applyRows({
			rows: firstRows.concat(userRow("user-2", { timestampMs: startedAtMs + 4_000 })),
			reason: "rows-updated",
		});

		expect(readModel.selectThinkingDurationMs(0, startedAtMs + 10_000)).toBe(4_000);
	});

	it("selects elapsed thinking durations for waiting rows", () => {
		const readModel = createTranscriptViewportRowsReadModel();
		const startedAtMs = Date.parse("2026-01-01T00:00:00.000Z");
		readModel.applyRows({
			rows: [userRow("user-1"), thinkingRow("Working", startedAtMs)],
			reason: "waiting-row-appended",
		});

		expect(readModel.selectThinkingDurationMs(1, startedAtMs + 2_500)).toBe(2_500);
	});

	it("selects nearby row diagnostics without exposing row slicing to callers", () => {
		const readModel = createTranscriptViewportRowsReadModel();
		readModel.applyRows({
			rows: [userRow("user-1"), assistantRow("assistant-1"), toolRow("tool-1"), userRow("user-2")],
			reason: "rows-updated",
		});

		expect(readModel.selectNearbyRowDiagnostics(2, 1)).toEqual([
			{ type: "assistant_merged", key: "assistant-1" },
			{ type: "tool_call", key: "tool-1" },
			{ type: "user", key: "user-2" },
		]);
		expect(readModel.selectNearbyRowDiagnostics(undefined, 1)).toEqual([
			{ type: "user", key: "user-1" },
			{ type: "assistant_merged", key: "assistant-1" },
		]);
	});
});

describe("buildTranscriptViewportRowsSummary", () => {
	it("builds the same summary shape used by the viewport controller", () => {
		const summary = buildTranscriptViewportRowsSummary(
			[userRow("user-1"), assistantRow("assistant-1"), thinkingRow("Working")],
			"waiting-row-appended"
		);

		expect(summary).toEqual({
			version: 3,
			count: 3,
			firstKey: "user-1",
			lastKey: "thinking-indicator",
			latestUserKey: "user-1",
			lastUserRowIndex: 0,
			userRowIndexes: [0],
			rowKeys: ["user-1", "assistant-1", "thinking-indicator"],
			rowIndexByKey: new Map([
				["user-1", 0],
				["assistant-1", 1],
				["thinking-indicator", 2],
			]),
			anchorEligibleKeys: ["user-1", "assistant-1"],
			hasLiveAssistantDisplayEntry: false,
			hasTokenRevealAssistantEntry: false,
			hasToolCallEntry: false,
			lastLiveAssistantDisplayEntryIndex: null,
			lastTokenRevealAssistantEntryIndex: null,
			lastToolCallEntryIndex: null,
			liveAssistantDisplayEntryIndexes: [],
			tokenRevealAssistantEntryIndexes: [],
			toolCallEntryIndexes: [],
			reason: "waiting-row-appended",
		});
	});
});

function userRow(id: string, options: { readonly timestampMs?: number } = {}): SceneDisplayRow {
	return {
		id,
		type: "user",
		text: "Prompt",
		timestamp: options.timestampMs === undefined ? undefined : new Date(options.timestampMs),
	} as unknown as SceneDisplayRow;
}

function assistantRow(
	id: string,
	options: {
		readonly tokenReveal?: boolean;
		readonly isStreaming?: boolean;
		readonly thought?: boolean;
		readonly timestampMs?: number;
	} = {}
): SceneDisplayRow {
	return {
		key: id,
		type: "assistant_merged",
		memberIds: [id],
		markdown: "Answer",
		message: {
			chunks: [
				options.thought
					? { type: "thought", block: { type: "text", text: "Thinking" } }
					: { type: "message", block: { type: "text", text: "Answer" } },
			],
		},
		timestamp: options.timestampMs === undefined ? undefined : new Date(options.timestampMs),
		isStreaming: options.isStreaming,
		tokenRevealCss: options.tokenReveal
			? {
					revealCount: 1,
					revealedCharCount: 1,
					baselineMs: 0,
					tokStepMs: 1,
					tokFadeDurMs: 1,
					mode: "smooth",
				}
			: undefined,
	} as SceneDisplayRow;
}

function toolRow(id: string): SceneDisplayRow {
	return {
		id,
		type: "tool_call",
		title: "Run",
		status: "done",
	} as unknown as SceneDisplayRow;
}

function missingRow(id: string): SceneDisplayRow {
	return {
		id,
		type: "missing",
		diagnosticLabel: id,
	} as unknown as SceneDisplayRow;
}

function thinkingRow(label: string, startedAtMs = 1): SceneDisplayRow {
	return {
		id: "thinking-indicator",
		type: "thinking",
		startedAtMs,
		label,
	} as SceneDisplayRow;
}
