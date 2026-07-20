import { okAsync } from "neverthrow";
import { describe, expect, it, vi } from "vitest";
import type {
	SessionGraphRevision,
	TranscriptRowPageResult,
	TranscriptScope,
	TranscriptViewportRow,
} from "../../../../../services/acp-types.js";
import {
	TaskTranscriptDialogController,
	type TaskTranscriptPageInput,
	taskTranscriptDialogIdentity,
} from "../task-transcript-dialog-controller.svelte.js";

const revision: SessionGraphRevision = {
	graphRevision: 11,
	transcriptRevision: 7,
	lastEventSeq: 13,
};

const scope: TranscriptScope = {
	kind: "operation",
	operationId: "operation-task-1",
};

function row(rowId: string): TranscriptViewportRow {
	return {
		rowId,
		sourceEntryId: rowId,
		scope,
		kind: "assistantText",
		version: `${rowId}:v1`,
		anchorEligible: true,
		activeStreamingTail: null,
		operationLinks: [],
		interactionLinks: [],
		content: { kind: "transcript", role: "assistant", segments: [] },
	};
}

function currentPage(
	startRowIndex: number,
	totalRowCount: number,
	rows: readonly TranscriptViewportRow[]
): TranscriptRowPageResult {
	return currentPageForRevision(startRowIndex, totalRowCount, rows, revision);
}

function currentPageForRevision(
	startRowIndex: number,
	totalRowCount: number,
	rows: readonly TranscriptViewportRow[],
	pageRevision: SessionGraphRevision
): TranscriptRowPageResult {
	return {
		status: "current",
		projectionVersion: "transcript_viewport_row:v17",
		startRowIndex,
		totalRowCount,
		rowPayloadBytes: 1,
		transcriptRevision: pageRevision.transcriptRevision,
		graphRevision: pageRevision.graphRevision,
		lastEventSeq: pageRevision.lastEventSeq,
		rows: Array.from(rows),
	};
}

const refreshedRevision: SessionGraphRevision = {
	graphRevision: 12,
	transcriptRevision: 8,
	lastEventSeq: 14,
};

function stalePage(): TranscriptRowPageResult {
	return {
		status: "stale",
		projectionVersion: "transcript_viewport_row:v17",
		totalRowCount: 1,
		transcriptRevision: refreshedRevision.transcriptRevision,
		graphRevision: refreshedRevision.graphRevision,
		lastEventSeq: refreshedRevision.lastEventSeq,
	};
}

async function settleResultAsync(): Promise<void> {
	await Promise.resolve();
	await Promise.resolve();
}

describe("TaskTranscriptDialogController", () => {
	it("loads and paginates ordinary operation-scoped rows in canonical order", async () => {
		const readPage = vi.fn((input: TaskTranscriptPageInput) => {
			if (input.startRowIndex === 0) {
				return okAsync(currentPage(0, 3, [row("thought"), row("tool")]));
			}
			return okAsync(currentPage(2, 3, [row("final")]));
		});
		const controller = new TaskTranscriptDialogController({ readPage });
		const identity = taskTranscriptDialogIdentity({
			sessionId: "session-1",
			panelId: "panel-1",
			rootRowId: "transcript:root:task-entry-1",
			operationId: "operation-task-1",
		});

		controller.setOpen({ identity, scope, revision, open: true });
		await settleResultAsync();

		expect(controller.getState(identity)).toMatchObject({
			open: true,
			status: "ready",
			totalRowCount: 3,
			hasMore: true,
		});
		expect(controller.getState(identity).rows.map((entry) => entry.rowId)).toEqual([
			"thought",
			"tool",
		]);

		controller.loadNextPage(identity);
		await settleResultAsync();

		expect(controller.getState(identity).rows.map((entry) => entry.rowId)).toEqual([
			"thought",
			"tool",
			"final",
		]);
		expect(controller.getState(identity).hasMore).toBe(false);
		expect(readPage).toHaveBeenNthCalledWith(1, {
			sessionId: "session-1",
			scope,
			startRowIndex: 0,
			limit: 256,
			expectedRevision: revision,
		});
		expect(readPage).toHaveBeenNthCalledWith(2, {
			sessionId: "session-1",
			scope,
			startRowIndex: 2,
			limit: 256,
			expectedRevision: revision,
		});
	});

	it("keeps dialog state across parent row-version changes", async () => {
		const readPage = vi.fn(() => okAsync(currentPage(0, 1, [row("thought")])));
		const controller = new TaskTranscriptDialogController({ readPage });
		const identity = taskTranscriptDialogIdentity({
			sessionId: "session-1",
			panelId: "panel-1",
			rootRowId: "transcript:root:task-entry-1",
			operationId: "operation-task-1",
		});

		controller.setOpen({ identity, scope, revision, open: true });
		await settleResultAsync();
		controller.close(identity);
		expect(controller.getState(identity).open).toBe(false);
		controller.setOpen({ identity, scope, revision, open: true });

		expect(controller.getState(identity).open).toBe(true);
		expect(controller.getState(identity).rows.map((entry) => entry.rowId)).toEqual(["thought"]);
		expect(readPage).toHaveBeenCalledTimes(1);
	});

	it("refreshes an open task transcript when the canonical session revision advances", async () => {
		const readPage = vi
			.fn()
			.mockReturnValueOnce(okAsync(currentPage(0, 1, [row("thought")])))
			.mockReturnValueOnce(
				okAsync(currentPageForRevision(0, 2, [row("thought"), row("live-tool")], refreshedRevision))
			);
		const controller = new TaskTranscriptDialogController({ readPage });
		const identity = taskTranscriptDialogIdentity({
			sessionId: "session-1",
			panelId: "panel-1",
			rootRowId: "transcript:root:task-entry-1",
			operationId: "operation-task-1",
		});

		controller.setOpen({ identity, scope, revision, open: true });
		await settleResultAsync();
		controller.syncOpenRevision({ identity, scope, revision: refreshedRevision });
		await settleResultAsync();

		expect(controller.getState(identity)).toMatchObject({
			open: true,
			status: "ready",
			revision: refreshedRevision,
			totalRowCount: 2,
		});
		expect(controller.getState(identity).rows.map((entry) => entry.rowId)).toEqual([
			"thought",
			"live-tool",
		]);
		expect(readPage).toHaveBeenNthCalledWith(2, {
			sessionId: "session-1",
			scope,
			startRowIndex: 0,
			limit: 256,
			expectedRevision: refreshedRevision,
		});
	});

	it("retries with the returned revision when a live task transcript page is stale", async () => {
		const readPage = vi
			.fn()
			.mockReturnValueOnce(okAsync(stalePage()))
			.mockReturnValueOnce(okAsync(currentPage(0, 1, [row("read-result")])));
		const controller = new TaskTranscriptDialogController({ readPage });
		const identity = taskTranscriptDialogIdentity({
			sessionId: "session-1",
			panelId: "panel-1",
			rootRowId: "transcript:root:task-entry-1",
			operationId: "operation-task-1",
		});

		controller.setOpen({ identity, scope, revision, open: true });
		await settleResultAsync();

		expect(controller.getState(identity)).toMatchObject({
			open: true,
			status: "ready",
			errorMessage: null,
		});
		expect(controller.getState(identity).rows.map((entry) => entry.rowId)).toEqual(["read-result"]);
		expect(readPage).toHaveBeenNthCalledWith(1, {
			sessionId: "session-1",
			scope,
			startRowIndex: 0,
			limit: 256,
			expectedRevision: revision,
		});
		expect(readPage).toHaveBeenNthCalledWith(2, {
			sessionId: "session-1",
			scope,
			startRowIndex: 0,
			limit: 256,
			expectedRevision: refreshedRevision,
		});
	});
});
