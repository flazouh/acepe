import { describe, expect, it } from "vitest";
import type { BufferProjection, ViewportClientScrollState } from "../../../../store/transcript-viewport-store.svelte.js";
import type { SessionGraphRevision, SessionStateEnvelope, TranscriptViewportRow } from "../../../../../services/acp-types.js";
import type { AppError } from "../../../../errors/app-error.js";
import { TranscriptViewportWebviewAdapter } from "../transcript-viewport-webview-adapter.svelte.js";

function revision(): SessionGraphRevision {
	return {
		graphRevision: 1,
		transcriptRevision: 1,
		lastEventSeq: 1,
	};
}

function row(rowId: string): TranscriptViewportRow {
	return {
		rowId,
		sourceEntryId: rowId,
		kind: "assistantText",
		version: "v1",
		anchorEligible: true,
		activeStreamingTail: null,
		operationLinks: [],
		interactionLinks: [],
		content: {
			kind: "transcript",
			role: "assistant",
			segments: [],
		},
	};
}

function clientScroll(input?: {
	readonly pendingOutsideBufferScrollTopPx?: number | null;
	readonly activeOutsideBufferRequestedScrollTopPx?: number | null;
	readonly lastOutsideBufferRecoveryDispatchMs?: number | null;
	readonly lastBottomRevealDispatchMs?: number | null;
	readonly pendingQueuedScrollIntentPx?: number | null;
}): ViewportClientScrollState {
	return {
		pendingOutsideBufferScrollTopPx: input?.pendingOutsideBufferScrollTopPx ?? null,
		activeOutsideBufferRequestedScrollTopPx:
			input?.activeOutsideBufferRequestedScrollTopPx ?? null,
		lastOutsideBufferRecoveryDispatchMs: input?.lastOutsideBufferRecoveryDispatchMs ?? null,
		lastBottomRevealDispatchMs: input?.lastBottomRevealDispatchMs ?? null,
		pendingQueuedScrollIntentPx: input?.pendingQueuedScrollIntentPx ?? null,
	};
}

function projection(input?: {
	readonly sessionId?: string;
	readonly emissionSeq?: number;
	readonly bufferStartIndex?: number;
	readonly bufferEndIndex?: number;
	readonly layoutRowCount?: number;
	readonly totalHeightPx?: number;
	readonly bufferEndOffsetPx?: number;
	readonly rows?: readonly TranscriptViewportRow[];
	readonly offsetsPx?: readonly number[];
	readonly mode?: BufferProjection["mode"];
	readonly scrollTopTarget?: number | null;
}): BufferProjection {
	const rows =
		input?.rows === undefined ? [row("row-1"), row("row-2")] : Array.from(input.rows);
	const offsetsPx = input?.offsetsPx === undefined ? [0, 500] : Array.from(input.offsetsPx);
	return {
		sessionId: input?.sessionId ?? "session-a",
		revision: revision(),
		viewportRevision: 1,
		emissionSeq: input?.emissionSeq ?? 1,
		bufferStartIndex: input?.bufferStartIndex ?? 0,
		bufferEndIndex: input?.bufferEndIndex ?? rows.length,
		layoutRowCount: input?.layoutRowCount ?? rows.length,
		totalHeightPx: input?.totalHeightPx ?? 1_000,
		bufferEndOffsetPx: input?.bufferEndOffsetPx ?? 1_000,
		rows,
		offsetsPx,
		mode: input?.mode ?? { kind: "followingTail" },
		scrollTopTarget: input?.scrollTopTarget ?? null,
		scrollAnchorCorrectionPx: null,
		diagnostics: [],
		lastGeneration: null,
	};
}

function createScrollContainer(input: {
	readonly scrollTop: number;
	readonly scrollHeight: number;
	readonly clientHeight: number;
	readonly rowRects?: readonly { readonly rowId: string; readonly top: number; readonly bottom: number }[];
}): {
	readonly node: HTMLDivElement;
	readonly scrollWrites: () => readonly number[];
} {
	const node = document.createElement("div");
	let scrollTop = input.scrollTop;
	const scrollWrites: number[] = [];
	Object.defineProperty(node, "scrollTop", {
		get() {
			return scrollTop;
		},
		set(next: number) {
			scrollTop = next;
			scrollWrites.push(next);
		},
		configurable: true,
	});
	Object.defineProperty(node, "scrollHeight", {
		get() {
			return input.scrollHeight;
		},
		configurable: true,
	});
	Object.defineProperty(node, "clientHeight", {
		get() {
			return input.clientHeight;
		},
		configurable: true,
	});
	node.getBoundingClientRect = () => new DOMRect(0, 0, 600, input.clientHeight);

	for (const rowRect of input.rowRects ?? []) {
		const child = document.createElement("div");
		child.setAttribute("data-entry-key", rowRect.rowId);
		child.getBoundingClientRect = () =>
			new DOMRect(0, rowRect.top, 600, rowRect.bottom - rowRect.top);
		node.appendChild(child);
	}

	return {
		node,
		scrollWrites: () => scrollWrites,
	};
}

function createFrameDriver(): {
	readonly requestAnimationFrame: (callback: FrameRequestCallback) => number;
	readonly flushAll: () => void;
	readonly pendingCount: () => number;
} {
	const callbacks: FrameRequestCallback[] = [];
	return {
		requestAnimationFrame(callback) {
			callbacks.push(callback);
			return callbacks.length;
		},
		flushAll() {
			while (callbacks.length > 0) {
				const callback = callbacks.shift();
				if (callback !== undefined) {
					callback(1_000);
				}
			}
		},
		pendingCount() {
			return callbacks.length;
		},
	};
}

function createHarness(input?: {
	readonly sessionId?: string | null;
	readonly projection?: BufferProjection | null;
	readonly clientScroll?: ViewportClientScrollState;
	readonly scrollCorrectionPx?: number;
}): {
	readonly adapter: TranscriptViewportWebviewAdapter;
	readonly frameDriver: ReturnType<typeof createFrameDriver>;
	readonly state: {
		sessionId: string | null;
		projection: BufferProjection | null;
		clientScroll: ViewportClientScrollState;
		lastViewportHeightPx: number;
		scrollCorrectionPx: number;
		outsideBufferChecks: readonly number[];
		needsRefillChecks: readonly number[];
		forcedScrollIntents: readonly number[];
		scrollIntents: readonly number[];
		pendingOutsideBuffer: readonly {
			readonly sessionId: string;
			readonly pending: number | null;
			readonly active: number | null;
		}[];
	};
} {
	const frameDriver = createFrameDriver();
	const outsideBufferChecks: number[] = [];
	const needsRefillChecks: number[] = [];
	const forcedScrollIntents: number[] = [];
	const scrollIntents: number[] = [];
	const pendingOutsideBuffer: {
		readonly sessionId: string;
		readonly pending: number | null;
		readonly active: number | null;
	}[] = [];
	const state = {
		sessionId: input?.sessionId ?? "session-a",
		projection: input?.projection ?? projection(),
		clientScroll: input?.clientScroll ?? clientScroll(),
		lastViewportHeightPx: 200,
		scrollCorrectionPx: input?.scrollCorrectionPx ?? 0,
		outsideBufferChecks,
		needsRefillChecks,
		forcedScrollIntents,
		scrollIntents,
		pendingOutsideBuffer,
	};
	const adapter = new TranscriptViewportWebviewAdapter({
		getSessionId: () => state.sessionId,
		getBufferProjection: () => state.projection,
		getBufferRows: () => state.projection?.rows ?? [],
		getViewportClientScroll: () => state.clientScroll,
		getTotalHeightPx: () => state.projection?.totalHeightPx ?? 0,
		getLastViewportHeightPx: () => state.lastViewportHeightPx,
		setLastViewportHeightPx: (heightPx) => {
			state.lastViewportHeightPx = heightPx;
		},
		getRevision: () => state.projection?.revision ?? null,
		isDispatchSuppressed: () => false,
		nextViewportRequestGeneration: () => 1,
		applyEnvelope: (_envelope: SessionStateEnvelope | null) => undefined,
		handleDispatchError: (_error: AppError) => undefined,
		dispatchScrollIntent: (offsetPx, options) => {
			if (options?.forceFresh === true) {
				forcedScrollIntents.push(offsetPx);
				return;
			}
			scrollIntents.push(offsetPx);
		},
		dispatchRevealIntent: (_rowId) => undefined,
		dispatchResizeIntent: (_heightPx) => undefined,
		viewportState: {
			isOutsideBuffer: (_sessionId, scrollTopPx) => {
				outsideBufferChecks.push(scrollTopPx);
				return false;
			},
			needsRefill: (_sessionId, scrollTopPx) => {
				needsRefillChecks.push(scrollTopPx);
				return false;
			},
			setPendingOutsideBufferScrollTopPx: (sessionId, pending, active) => {
				state.clientScroll = clientScroll({
					pendingOutsideBufferScrollTopPx: pending,
					activeOutsideBufferRequestedScrollTopPx: active,
					lastOutsideBufferRecoveryDispatchMs:
						state.clientScroll.lastOutsideBufferRecoveryDispatchMs,
					lastBottomRevealDispatchMs: state.clientScroll.lastBottomRevealDispatchMs,
					pendingQueuedScrollIntentPx: state.clientScroll.pendingQueuedScrollIntentPx,
				});
				pendingOutsideBuffer.push({ sessionId, pending, active });
			},
			setLastOutsideBufferRecoveryDispatchMs: (_sessionId, lastDispatchMs) => {
				state.clientScroll = clientScroll({
					pendingOutsideBufferScrollTopPx: state.clientScroll.pendingOutsideBufferScrollTopPx,
					activeOutsideBufferRequestedScrollTopPx:
						state.clientScroll.activeOutsideBufferRequestedScrollTopPx,
					lastOutsideBufferRecoveryDispatchMs: lastDispatchMs,
					lastBottomRevealDispatchMs: state.clientScroll.lastBottomRevealDispatchMs,
					pendingQueuedScrollIntentPx: state.clientScroll.pendingQueuedScrollIntentPx,
				});
			},
			setLastBottomRevealDispatchMs: (_sessionId, lastDispatchMs) => {
				state.clientScroll = clientScroll({
					pendingOutsideBufferScrollTopPx: state.clientScroll.pendingOutsideBufferScrollTopPx,
					activeOutsideBufferRequestedScrollTopPx:
						state.clientScroll.activeOutsideBufferRequestedScrollTopPx,
					lastOutsideBufferRecoveryDispatchMs:
						state.clientScroll.lastOutsideBufferRecoveryDispatchMs,
					lastBottomRevealDispatchMs: lastDispatchMs,
					pendingQueuedScrollIntentPx: state.clientScroll.pendingQueuedScrollIntentPx,
				});
			},
			setPendingQueuedScrollIntentPx: (_sessionId, pendingQueuedScrollIntentPx) => {
				state.clientScroll = clientScroll({
					pendingOutsideBufferScrollTopPx: state.clientScroll.pendingOutsideBufferScrollTopPx,
					activeOutsideBufferRequestedScrollTopPx:
						state.clientScroll.activeOutsideBufferRequestedScrollTopPx,
					lastOutsideBufferRecoveryDispatchMs:
						state.clientScroll.lastOutsideBufferRecoveryDispatchMs,
					lastBottomRevealDispatchMs: state.clientScroll.lastBottomRevealDispatchMs,
					pendingQueuedScrollIntentPx,
				});
			},
			clearOutsideBufferRecovery: (_sessionId) => {
				state.clientScroll = clientScroll({
					lastBottomRevealDispatchMs: state.clientScroll.lastBottomRevealDispatchMs,
					pendingQueuedScrollIntentPx: state.clientScroll.pendingQueuedScrollIntentPx,
				});
			},
			consumeScrollCorrectionPx: (_sessionId) => {
				const correction = state.scrollCorrectionPx;
				state.scrollCorrectionPx = 0;
				return correction;
			},
		},
		afterRender: () => Promise.resolve(),
		requestAnimationFrame: frameDriver.requestAnimationFrame,
		nowMs: () => 2_000,
	});
	return { adapter, frameDriver, state };
}

describe("TranscriptViewportWebviewAdapter", () => {
	it("pins a following-tail projection to the rendered bottom after rows grow", async () => {
		const { adapter, frameDriver, state } = createHarness({
			projection: projection({ totalHeightPx: 1_000, emissionSeq: 7 }),
		});
		const { node, scrollWrites } = createScrollContainer({
			scrollTop: 795,
			scrollHeight: 1_000,
			clientHeight: 200,
			rowRects: [
				{ rowId: "row-1", top: 0, bottom: 500 },
				{ rowId: "row-2", top: 500, bottom: 1_000 },
			],
		});
		adapter.attachScrollContainer(node);

		adapter.reconcileFollowingTailLayoutGrowth();
		await Promise.resolve();
		frameDriver.flushAll();

		expect(scrollWrites()).toEqual([800]);
		expect(state.scrollIntents).toEqual([]);
	});

	it("drops a pending physical scroll command when the session owner changes", async () => {
		const { adapter, frameDriver, state } = createHarness({
			projection: projection({ emissionSeq: 1, scrollTopTarget: 700 }),
		});
		const { node, scrollWrites } = createScrollContainer({
			scrollTop: 100,
			scrollHeight: 1_000,
			clientHeight: 200,
		});
		adapter.attachScrollContainer(node);

		adapter.reconcileRustScrollTopTarget();
		await Promise.resolve();
		expect(frameDriver.pendingCount()).toBe(1);
		state.sessionId = "session-b";
		state.projection = projection({ sessionId: "session-b", emissionSeq: 1 });
		adapter.syncSessionOwner();
		frameDriver.flushAll();

		expect(scrollWrites()).toEqual([]);

		state.projection = projection({ sessionId: "session-b", emissionSeq: 1, scrollTopTarget: 650 });
		adapter.reconcileRustScrollTopTarget();
		await Promise.resolve();
		frameDriver.flushAll();

		expect(scrollWrites()).toEqual([650]);
	});

	it("clamps outside-buffer scroll locally while dispatching a forced refill intent", () => {
		const { adapter, frameDriver, state } = createHarness({
			projection: projection({
				totalHeightPx: 700_000,
				bufferStartIndex: 200,
				bufferEndIndex: 220,
				layoutRowCount: 400,
				bufferEndOffsetPx: 655_000,
				offsetsPx: [640_000, 641_000],
			}),
		});
		const { node, scrollWrites } = createScrollContainer({
			scrollTop: 0,
			scrollHeight: 700_000,
			clientHeight: 500,
		});
		state.lastViewportHeightPx = 500;
		adapter.attachScrollContainer(node);
		const event = new Event("scroll");
		Object.defineProperty(event, "currentTarget", { value: node });

		adapter.handleScroll(event);

		expect(scrollWrites()[0]).toBe(640_000);
		expect(state.pendingOutsideBuffer).toEqual([
			{ sessionId: "session-a", pending: 0, active: 0 },
		]);
		expect(state.forcedScrollIntents).toEqual([0]);
	});

	it("applies a detached anchor correction without dispatching a scroll intent", async () => {
		const { adapter, frameDriver, state } = createHarness({
			projection: projection({
				emissionSeq: 4,
				mode: {
					kind: "detached",
					anchorRowId: "row-1",
					offsetFromAnchorPx: 20,
				},
			}),
			scrollCorrectionPx: 48,
		});
		const { node, scrollWrites } = createScrollContainer({
			scrollTop: 300,
			scrollHeight: 1_000,
			clientHeight: 200,
		});
		adapter.attachScrollContainer(node);

		adapter.reconcileScrollAnchorCorrection();
		await Promise.resolve();
		frameDriver.flushAll();

		expect(scrollWrites()).toEqual([348]);
		expect(state.scrollIntents).toEqual([]);
		expect(state.forcedScrollIntents).toEqual([]);
	});

	it("scrollToTop physically moves the viewport and requests a fresh top intent", () => {
		const { adapter, state } = createHarness({
			projection: projection({ mode: { kind: "followingTail" } }),
		});
		const { node, scrollWrites } = createScrollContainer({
			scrollTop: 800,
			scrollHeight: 1200,
			clientHeight: 400,
		});
		adapter.attachScrollContainer(node);

		adapter.scrollToTop();

		expect(scrollWrites()).toEqual([0]);
		expect(state.forcedScrollIntents).toEqual([0]);
	});
});
