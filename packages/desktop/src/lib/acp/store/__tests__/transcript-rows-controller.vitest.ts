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
		});

		controller.ensureRowsBootstrap("session-1");

		expect(mocks.requestTranscriptViewportBuffer).not.toHaveBeenCalled();
		expect(controller.getRowsProjection("session-1")?.rows).toEqual([]);
	});
});
