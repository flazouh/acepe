import { describe, expect, it, vi } from "vitest";
import {
	createNativeTranscriptRendererAdapter,
	createVirtuaTranscriptRendererAdapter,
} from "../transcript-renderer-adapter.js";

describe("TranscriptRendererAdapter", () => {
	it("normalizes Virtua viewport measurement", () => {
		const adapter = createVirtuaTranscriptRendererAdapter({
			getHandle: () => {
				return {
					getScrollOffset: () => 40,
					getScrollSize: () => 900,
					getViewportSize: () => 300,
					scrollToIndex: vi.fn(),
					scrollTo: vi.fn(),
				};
			},
			getRowKeys: () => ["row-1", "row-2"],
		});

		expect(adapter.measureViewport()).toEqual({
			type: "measured",
			measurement: {
				scrollOffset: 40,
				scrollSize: 900,
				viewportSize: 300,
			},
		});
	});

	it("reports missing Virtua target instead of scrolling fallback by itself", () => {
		const scrollToIndex = vi.fn();
		const adapter = createVirtuaTranscriptRendererAdapter({
			getHandle: () => {
				return {
					getScrollOffset: () => 0,
					getScrollSize: () => 900,
					getViewportSize: () => 300,
					scrollToIndex,
					scrollTo: vi.fn(),
				};
			},
			getRowKeys: () => ["row-1"],
		});

		const outcome = adapter.revealRow({
			type: "RevealRow",
			sessionId: "session-1",
			generation: 0,
			targetKey: "missing-row",
			align: "end",
			reason: "explicit-reveal",
		});

		expect(outcome).toEqual({
			type: "skipped",
			effectType: "RevealRow",
			reason: "missing-target",
		});
		expect(scrollToIndex).not.toHaveBeenCalled();
	});

	it("treats a null Virtua handle as temporarily missing during teardown", () => {
		const adapter = createVirtuaTranscriptRendererAdapter({
			getHandle: () => null as never,
			getRowKeys: () => ["row-1"],
		});

		expect(
			adapter.revealRow({
				type: "RevealRow",
				sessionId: "session-1",
				generation: 0,
				targetKey: "row-1",
				align: "end",
				reason: "explicit-reveal",
			})
		).toEqual({
			type: "skipped",
			effectType: "RevealRow",
			reason: "missing-adapter",
		});
	});

	it("normalizes native viewport measurement", () => {
		const container = document.createElement("div");
		Object.defineProperty(container, "scrollTop", {
			configurable: true,
			value: 40,
		});
		Object.defineProperty(container, "scrollHeight", {
			configurable: true,
			value: 900,
		});
		Object.defineProperty(container, "clientHeight", {
			configurable: true,
			value: 300,
		});

		const adapter = createNativeTranscriptRendererAdapter({
			getContainer: () => container,
			getRowKeys: () => ["row-1"],
			getRowElement: () => null,
		});

		expect(adapter.measureViewport()).toEqual({
			type: "measured",
			measurement: {
				scrollOffset: 40,
				scrollSize: 900,
				viewportSize: 300,
			},
		});
	});
});
