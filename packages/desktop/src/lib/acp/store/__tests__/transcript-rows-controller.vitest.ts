import { fromPromise } from "@acepe/effect-result/fromPromise";
import * as Effect from "effect/Effect";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type {
	SessionGraphRevision,
	SessionOpenTranscriptRowPage,
	SessionStateEnvelope,
	TranscriptEntry,
	TranscriptRowPageResult,
	TranscriptViewportRow,
	ViewportBufferPush,
} from "../../../services/acp-types.js";

const mocks = vi.hoisted(() => ({
	readTranscriptRowPage: vi.fn(),
	requestTranscriptViewportBuffer: vi.fn(),
	runningUnderElectrobun: vi.fn(),
}));

vi.mock("../../session-state/session-state-viewport-command-service.js", () => ({
	readTranscriptRowPage: mocks.readTranscriptRowPage,
	requestTranscriptViewportBuffer: mocks.requestTranscriptViewportBuffer,
}));

vi.mock("../../../utils/electrobun-window-shims.js", () => ({
	runningUnderElectrobun: mocks.runningUnderElectrobun,
}));

import { TranscriptRowsController } from "../transcript-rows-controller.svelte.js";

function revision(
	graphRevision: number,
	transcriptRevision: number,
	lastEventSeq: number
): SessionGraphRevision {
	return {
		graphRevision,
		transcriptRevision,
		lastEventSeq,
	};
}

function row(rowId: string): TranscriptViewportRow {
	return {
		rowId,
		sourceEntryId: rowId,
		kind: "assistantText",
		version: `${rowId}:v1`,
		anchorEligible: true,
		activeStreamingTail: null,
		operationLinks: [],
		interactionLinks: [],
		content: { kind: "transcript", role: "assistant", segments: [] },
	};
}

function page(
	startRowIndex: number,
	rows: readonly TranscriptViewportRow[],
	pageRevision: SessionGraphRevision
): SessionOpenTranscriptRowPage {
	return {
		projectionVersion: "transcript_viewport_row:v5",
		startRowIndex,
		totalRowCount: 512,
		rowPayloadBytes: 1,
		transcriptRevision: pageRevision.transcriptRevision,
		graphRevision: pageRevision.graphRevision,
		lastEventSeq: pageRevision.lastEventSeq,
		rows: Array.from(rows),
	};
}

function viewportPushEnvelope(sessionId: string, push: ViewportBufferPush): SessionStateEnvelope {
	return {
		sessionId,
		graphRevision: push.graphRevision.graphRevision,
		lastEventSeq: push.graphRevision.lastEventSeq,
		payload: {
			kind: "viewportBufferPush",
			push,
		},
	};
}

describe("TranscriptRowsController older-row paging", () => {
	beforeEach(() => {
		mocks.readTranscriptRowPage.mockReset();
		mocks.requestTranscriptViewportBuffer.mockReset();
		mocks.runningUnderElectrobun.mockReturnValue(false);
	});

	it("uses the displayed row-page revision when requesting older restored rows", () => {
		const pageRevision = revision(11, 7, 13);
		const liveGraphRevision = revision(99, 88, 77);
		const olderPageResult: TranscriptRowPageResult = {
			status: "current",
			projectionVersion: "transcript_viewport_row:v5",
			startRowIndex: 0,
			totalRowCount: 512,
			rowPayloadBytes: 1,
			transcriptRevision: pageRevision.transcriptRevision,
			graphRevision: pageRevision.graphRevision,
			lastEventSeq: pageRevision.lastEventSeq,
			rows: [row("older-row")],
		};
		mocks.readTranscriptRowPage.mockReturnValue(Effect.succeed(olderPageResult));
		const controller = new TranscriptRowsController({
			getGraphRevision: () => liveGraphRevision,
			getTranscriptEntries: () => null,
			getOperations: () => null,
			applySessionStateEnvelope: (_sessionId: string, _envelope: SessionStateEnvelope) => undefined,
		});

		controller.applyInitialRowPage("session-1", page(256, [row("tail-row")], pageRevision));
		controller.requestOlderRows("session-1");

		expect(mocks.readTranscriptRowPage).toHaveBeenCalledWith({
			sessionId: "session-1",
			scope: { kind: "root" },
			startRowIndex: 0,
			limit: 256,
			expectedRevision: pageRevision,
		});
		expect(mocks.requestTranscriptViewportBuffer).not.toHaveBeenCalled();
	});

	it("ignores stale fresh-bootstrap responses after an initial row page applies", async () => {
		const pageRevision = revision(11, 7, 13);
		const liveGraphRevision = revision(99, 88, 77);
		let resolveFreshEnvelope: (envelope: SessionStateEnvelope | null) => void = () => undefined;
		const freshEnvelopePromise = new Promise<SessionStateEnvelope | null>((resolve) => {
			resolveFreshEnvelope = resolve;
		});
		mocks.requestTranscriptViewportBuffer.mockReturnValue(
			fromPromise(() => freshEnvelopePromise, (error) => (error instanceof Error ? error : new Error(String(error))))
		);
		const appliedEnvelopes: SessionStateEnvelope[] = [];
		const controller = new TranscriptRowsController({
			getGraphRevision: () => liveGraphRevision,
			getTranscriptEntries: () => null,
			getOperations: () => null,
			applySessionStateEnvelope: (_sessionId: string, envelope: SessionStateEnvelope) => {
				appliedEnvelopes.push(envelope);
			},
		});
		const staleFreshPush: ViewportBufferPush = {
			sessionId: "session-1",
			graphRevision: liveGraphRevision,
			emissionSeq: 4,
			rows: [],
			requestGeneration: 1,
			diagnostics: [],
		};

		controller.ensureRowsBootstrap("session-1");
		controller.applyInitialRowPage("session-1", page(256, [row("tail-row")], pageRevision));
		resolveFreshEnvelope(viewportPushEnvelope("session-1", staleFreshPush));
		await Promise.resolve();
		await Promise.resolve();

		expect(appliedEnvelopes).toEqual([]);
	});

	it("does not let an empty request-generated push erase a loaded ledger page", () => {
		const pageRevision = revision(11, 7, 13);
		const liveGraphRevision = revision(99, 88, 77);
		const controller = new TranscriptRowsController({
			getGraphRevision: () => liveGraphRevision,
			getTranscriptEntries: () => null,
			getOperations: () => null,
			applySessionStateEnvelope: (_sessionId: string, _envelope: SessionStateEnvelope) => undefined,
		});
		const emptyFreshPush: ViewportBufferPush = {
			sessionId: "session-1",
			graphRevision: liveGraphRevision,
			emissionSeq: 6,
			rows: [],
			requestGeneration: 3,
			diagnostics: [],
		};

		controller.applyInitialRowPage("session-1", page(256, [row("tail-row")], pageRevision));
		controller.applyBufferPush(emptyFreshPush);

		expect(controller.getRowsProjection("session-1")?.rows.map((value) => value.rowId)).toEqual([
			"tail-row",
		]);
		expect(controller.getRowsDiagnostics("session-1")).toMatchObject({
			action: "apply-push",
			status: "ignored",
			rowCount: 0,
			previousRowCount: 1,
			requestGeneration: 3,
			reason: "empty-request-push-after-ledger-page:unknown:initial",
		});
	});

	it("does not let an empty live reconnect push erase a loaded ledger page", () => {
		const pageRevision = revision(11, 7, 13);
		const liveGraphRevision = revision(99, 88, 77);
		const controller = new TranscriptRowsController({
			getGraphRevision: () => liveGraphRevision,
			getTranscriptEntries: () => null,
			getOperations: () => null,
			applySessionStateEnvelope: (_sessionId: string, _envelope: SessionStateEnvelope) => undefined,
		});
		const emptyLivePush: ViewportBufferPush = {
			sessionId: "session-1",
			graphRevision: liveGraphRevision,
			emissionSeq: 6,
			rows: [],
			requestGeneration: null,
			diagnostics: [],
		};

		controller.applyInitialRowPage("session-1", page(256, [row("tail-row")], pageRevision));
		controller.applyBufferPush(emptyLivePush);

		expect(controller.getRowsProjection("session-1")?.rows.map((value) => value.rowId)).toEqual([
			"tail-row",
		]);
		expect(controller.getRowsDiagnostics("session-1")).toMatchObject({
			action: "apply-push",
			status: "ignored",
			rowCount: 0,
			previousRowCount: 1,
			requestGeneration: null,
			reason: "empty-live-push-after-ledger-page:initial",
		});
	});
});

describe("TranscriptRowsController under Electrobun (no viewport-buffer command backend)", () => {
	beforeEach(() => {
		mocks.readTranscriptRowPage.mockReset();
		mocks.requestTranscriptViewportBuffer.mockReset();
		mocks.runningUnderElectrobun.mockReturnValue(true);
	});

	it("derives rows locally from canonical transcript entries instead of calling the RPC", () => {
		const liveGraphRevision = revision(1, 1, 3);
		const entries: TranscriptEntry[] = [
			{
				entryId: "entry-1",
				role: "user",
				segments: [{ kind: "text", segmentId: "seg-1", text: "hi" }],
			},
		];
		const controller = new TranscriptRowsController({
			getGraphRevision: () => liveGraphRevision,
			applySessionStateEnvelope: () => undefined,
			getTranscriptEntries: () => entries,
			getOperations: () => null,
		});

		controller.ensureRowsBootstrap("session-1");

		expect(mocks.requestTranscriptViewportBuffer).not.toHaveBeenCalled();
		expect(controller.getRowsProjection("session-1")?.rows.map((value) => value.rowId)).toEqual([
			"entry-1",
		]);
	});

	it("renders an empty transcript rather than erroring when no canonical entries exist yet", () => {
		const liveGraphRevision = revision(1, 1, 3);
		const controller = new TranscriptRowsController({
			getGraphRevision: () => liveGraphRevision,
			applySessionStateEnvelope: () => undefined,
			getTranscriptEntries: () => null,
			getOperations: () => null,
		});

		controller.ensureRowsBootstrap("session-1");

		expect(mocks.requestTranscriptViewportBuffer).not.toHaveBeenCalled();
		expect(controller.getRowsProjection("session-1")?.rows).toEqual([]);
	});

	// Live-QA-reproduced bug: `ensureRowsBootstrap` fires exactly once per
	// session, commonly before the first message even exists (a freshly
	// created session gets its canonical graph revision before any transcript
	// entries do). Under Electrobun there is no `viewportBufferPush`/`Delta`
	// envelope producer to keep rows current after that one-shot bootstrap
	// (see requestFreshRows's own comment), so without a way to re-derive rows
	// as entries grow, the panel's rows permanently lock at whatever the
	// transcript looked like at bootstrap time -- usually empty. This is the
	// literal "rows never render, or render then get stuck" bug from a real
	// packaged-build QA session: `.message-scroller__content` stayed at
	// childCount:0 for the entire turn even though the canonical transcript
	// had real entries.
	it("re-derives rows from canonical entries when the transcript grows after bootstrap", () => {
		let entries: TranscriptEntry[] = [];
		const liveGraphRevision = () => revision(1, 1, entries.length === 0 ? 3 : 5);
		const controller = new TranscriptRowsController({
			getGraphRevision: () => liveGraphRevision(),
			applySessionStateEnvelope: () => undefined,
			getTranscriptEntries: () => entries,
			getOperations: () => null,
		});

		controller.ensureRowsBootstrap("session-1");
		expect(controller.getRowsProjection("session-1")?.rows).toEqual([]);

		// The user's message and the assistant's reply land on the canonical
		// graph after bootstrap -- exactly what a live send does.
		entries = [
			{
				entryId: "entry-user",
				role: "user",
				segments: [{ kind: "text", segmentId: "seg-user", text: "hi" }],
			},
			{
				entryId: "entry-assistant",
				role: "assistant",
				segments: [{ kind: "text", segmentId: "seg-assistant", text: "hello" }],
			},
		];
		controller.resyncElectrobunTranscriptRows("session-1", "transcript-revision:5");

		expect(controller.getRowsProjection("session-1")?.rows.map((value) => value.rowId)).toEqual([
			"entry-user",
			"entry-assistant",
		]);
	});

	it("does not regress rows on a stale (non-advancing) resync call", () => {
		let entries: TranscriptEntry[] = [
			{
				entryId: "entry-user",
				role: "user",
				segments: [{ kind: "text", segmentId: "seg-user", text: "hi" }],
			},
		];
		const revisionValue = revision(1, 1, 5);
		const controller = new TranscriptRowsController({
			getGraphRevision: () => revisionValue,
			applySessionStateEnvelope: () => undefined,
			getTranscriptEntries: () => entries,
			getOperations: () => null,
		});

		controller.ensureRowsBootstrap("session-1");
		expect(controller.getRowsProjection("session-1")?.rows.map((value) => value.rowId)).toEqual([
			"entry-user",
		]);

		// A duplicate resync at the same revision (e.g. an effect re-running
		// without the transcript actually advancing) must not be treated as a
		// fresher push that could otherwise clobber the loaded window.
		entries = [];
		controller.resyncElectrobunTranscriptRows("session-1", "transcript-revision:5");

		expect(controller.getRowsProjection("session-1")?.rows.map((value) => value.rowId)).toEqual([
			"entry-user",
		]);
	});
});

describe("TranscriptRowsController.resyncElectrobunTranscriptRows on Tauri", () => {
	beforeEach(() => {
		mocks.readTranscriptRowPage.mockReset();
		mocks.requestTranscriptViewportBuffer.mockReset();
		mocks.runningUnderElectrobun.mockReturnValue(false);
	});

	it("is a no-op on Tauri, where real envelopes keep rows current", () => {
		const liveGraphRevision = revision(1, 1, 3);
		const getTranscriptEntries = vi.fn(() => []);
		const controller = new TranscriptRowsController({
			getGraphRevision: () => liveGraphRevision,
			applySessionStateEnvelope: () => undefined,
			getTranscriptEntries,
			getOperations: () => null,
		});

		controller.resyncElectrobunTranscriptRows("session-1", "transcript-revision:3");

		expect(getTranscriptEntries).not.toHaveBeenCalled();
		expect(mocks.requestTranscriptViewportBuffer).not.toHaveBeenCalled();
	});
});
