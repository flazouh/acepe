import { describe, expect, it } from "vitest";
import { createTranscriptViewportScheduler } from "../transcript-viewport-scheduler.svelte.js";
import type { TranscriptRendererAdapter } from "../transcript-renderer-adapter.js";
import type { TranscriptViewportEffect } from "../transcript-viewport-effects.js";
import type { TranscriptViewportEvent } from "../transcript-viewport-events.js";

function createManualFrame() {
	let nextId = 1;
	const callbacks = new Map<number, FrameRequestCallback>();
	return {
		request(callback: FrameRequestCallback): number {
			const id = nextId;
			nextId += 1;
			callbacks.set(id, callback);
			return id;
		},
		cancel(id: number): void {
			callbacks.delete(id);
		},
		flush(): void {
			const queued = Array.from(callbacks.entries());
			callbacks.clear();
			for (const [id, callback] of queued) {
				callback(id);
			}
		},
	};
}

function createRecordingAdapter(order: string[]): TranscriptRendererAdapter {
	return {
		measureViewport() {
			order.push("read:measureViewport");
			return {
				type: "measured",
				measurement: {
					scrollOffset: 0,
					scrollSize: 1000,
					viewportSize: 300,
				},
			};
		},
		captureAnchor() {
			order.push("read:captureAnchor");
			return {
				type: "captured",
				anchorKey: "row-1",
				offsetPx: 12,
			};
		},
		measureAnchor(anchorKey) {
			order.push(`read:measureAnchor:${anchorKey}`);
			return {
				type: "measured",
				anchorKey,
				offsetPx: 12,
			};
		},
		revealRow(effect) {
			order.push(`write:revealRow:${effect.targetKey}`);
			return {
				type: "applied",
				effectType: effect.type,
			};
		},
		revealTail(effect) {
			order.push(`write:revealTail:${effect.reason}`);
			return {
				type: "applied",
				effectType: effect.type,
			};
		},
		applyScrollOffset(effect) {
			order.push(`write:applyScrollOffset:${String(effect.offsetPx)}`);
			return {
				type: "applied",
				effectType: effect.type,
			};
		},
		probeRendererHealth() {
			order.push("read:probeRendererHealth");
			return {
				type: "healthy",
			};
		},
		reportEffectOutcome(outcome) {
			order.push(`outcome:${outcome.type}`);
		},
	};
}

describe("TranscriptViewportScheduler", () => {
	it("executes all reads before writes in one animation frame", () => {
		const order: string[] = [];
		const frame = createManualFrame();
		const scheduler = createTranscriptViewportScheduler({
			adapter: createRecordingAdapter(order),
			requestFrame: frame.request,
			cancelFrame: frame.cancel,
			getGeneration: () => 0,
			getSessionId: () => "session-1",
		});

		const effects: TranscriptViewportEffect[] = [
			{
				type: "RevealTail",
				sessionId: "session-1",
				generation: 0,
				force: true,
				reason: "public-scroll-bottom",
			},
			{
				type: "MeasureViewport",
				sessionId: "session-1",
				generation: 0,
			},
			{
				type: "PreserveAnchor",
				sessionId: "session-1",
				generation: 0,
				anchorKey: "row-1",
				offsetPx: 12,
			},
		];

		scheduler.schedule(effects);
		frame.flush();

		expect(order).toEqual([
			"read:measureViewport",
			"read:measureAnchor:row-1",
			"read:measureViewport",
			"write:revealTail:public-scroll-bottom",
			"outcome:applied",
		]);
	});

	it("skips stale effects after a generation change", () => {
		const order: string[] = [];
		const frame = createManualFrame();
		const scheduler = createTranscriptViewportScheduler({
			adapter: createRecordingAdapter(order),
			requestFrame: frame.request,
			cancelFrame: frame.cancel,
			getGeneration: () => 1,
			getSessionId: () => "session-1",
		});

		scheduler.schedule([
			{
				type: "RevealTail",
				sessionId: "session-1",
				generation: 0,
				force: true,
				reason: "public-scroll-bottom",
			},
		]);
		frame.flush();

		expect(order).toEqual(["outcome:skipped"]);
	});

	it("feeds missing anchor reads back to the controller as events", () => {
		const order: string[] = [];
		const events: TranscriptViewportEvent[] = [];
		const frame = createManualFrame();
		const adapter = createRecordingAdapter(order);
		const scheduler = createTranscriptViewportScheduler({
			adapter: {
				measureViewport: adapter.measureViewport,
				captureAnchor: adapter.captureAnchor,
				measureAnchor(anchorKey) {
					order.push(`read:missingAnchor:${anchorKey}`);
					return {
						type: "missing",
						anchorKey,
						reason: "missing-target",
					};
				},
				revealRow: adapter.revealRow,
				revealTail: adapter.revealTail,
				applyScrollOffset: adapter.applyScrollOffset,
				probeRendererHealth: adapter.probeRendererHealth,
				reportEffectOutcome: adapter.reportEffectOutcome,
			},
			requestFrame: frame.request,
			cancelFrame: frame.cancel,
			getGeneration: () => 0,
			getSessionId: () => "session-1",
			dispatchEvent(event) {
				events.push(event);
			},
		});

		scheduler.schedule([
			{
				type: "PreserveAnchor",
				sessionId: "session-1",
				generation: 0,
				anchorKey: "missing-row",
				offsetPx: 0,
			},
		]);
		frame.flush();

		expect(events).toEqual([
			{
				type: "AdapterAnchorMissing",
				sessionId: "session-1",
				generation: 0,
				anchorKey: "missing-row",
				fallbackOffsetPx: 0,
			},
		]);
	});

	it("applies an offset correction when a preserved anchor moves in the viewport", () => {
		const order: string[] = [];
		const frame = createManualFrame();
		const adapter = createRecordingAdapter(order);
		const scheduler = createTranscriptViewportScheduler({
			adapter: {
				measureViewport() {
					order.push("read:measureViewport");
					return {
						type: "measured",
						measurement: {
							scrollOffset: 100,
							scrollSize: 1000,
							viewportSize: 300,
						},
					};
				},
				captureAnchor: adapter.captureAnchor,
				measureAnchor(anchorKey) {
					order.push(`read:measureAnchor:${anchorKey}`);
					return {
						type: "measured",
						anchorKey,
						offsetPx: 42,
					};
				},
				revealRow: adapter.revealRow,
				revealTail: adapter.revealTail,
				applyScrollOffset: adapter.applyScrollOffset,
				probeRendererHealth: adapter.probeRendererHealth,
				reportEffectOutcome: adapter.reportEffectOutcome,
			},
			requestFrame: frame.request,
			cancelFrame: frame.cancel,
			getGeneration: () => 0,
			getSessionId: () => "session-1",
		});

		scheduler.schedule([
			{
				type: "PreserveAnchor",
				sessionId: "session-1",
				generation: 0,
				anchorKey: "row-1",
				offsetPx: 12,
			} as TranscriptViewportEffect,
		]);
		frame.flush();

		expect(order).toEqual([
			"read:measureAnchor:row-1",
			"read:measureViewport",
			"write:applyScrollOffset:130",
			"outcome:applied",
		]);
	});

	it("drops queued scroll writes when the scheduler is cancelled before the frame flushes", () => {
		const order: string[] = [];
		const frame = createManualFrame();
		const scheduler = createTranscriptViewportScheduler({
			adapter: createRecordingAdapter(order),
			requestFrame: frame.request,
			cancelFrame: frame.cancel,
			getGeneration: () => 0,
			getSessionId: () => "session-1",
		});

		scheduler.schedule([
			{
				type: "RevealTail",
				sessionId: "session-1",
				generation: 0,
				force: false,
				reason: "rows-changed-following",
			},
		]);
		scheduler.cancel();
		frame.flush();

		expect(order).toEqual([]);
	});

	it("coalesces same-frame scroll writes down to the latest intent", () => {
		const order: string[] = [];
		const frame = createManualFrame();
		const scheduler = createTranscriptViewportScheduler({
			adapter: createRecordingAdapter(order),
			requestFrame: frame.request,
			cancelFrame: frame.cancel,
			getGeneration: () => 0,
			getSessionId: () => "session-1",
		});

		scheduler.schedule([
			{
				type: "RevealTail",
				sessionId: "session-1",
				generation: 0,
				force: false,
				reason: "rows-changed-following",
			},
			{
				type: "RevealRow",
				sessionId: "session-1",
				generation: 0,
				targetKey: "user-2",
				align: "end",
				reason: "send-started",
			},
		]);
		frame.flush();

		expect(order).toEqual([
			"write:revealRow:user-2",
			"outcome:applied",
		]);
	});

	it("keeps the latest preserve-anchor request in the same frame", () => {
		const order: string[] = [];
		const frame = createManualFrame();
		const scheduler = createTranscriptViewportScheduler({
			adapter: createRecordingAdapter(order),
			requestFrame: frame.request,
			cancelFrame: frame.cancel,
			getGeneration: () => 0,
			getSessionId: () => "session-1",
		});

		scheduler.schedule([
			{
				type: "PreserveAnchor",
				sessionId: "session-1",
				generation: 0,
				anchorKey: "row-1",
				offsetPx: 12,
			},
			{
				type: "PreserveAnchor",
				sessionId: "session-1",
				generation: 0,
				anchorKey: "row-2",
				offsetPx: 20,
			},
		]);
		frame.flush();

		expect(order).toEqual([
			"read:measureAnchor:row-2",
			"read:measureViewport",
			"write:applyScrollOffset:-8",
			"outcome:applied",
		]);
	});
});
