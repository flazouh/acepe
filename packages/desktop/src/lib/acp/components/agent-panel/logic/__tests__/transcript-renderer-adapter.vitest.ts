import { describe, expect, it, vi } from "vitest";
import {
	createNativeTranscriptRendererAdapter,
	createTranscriptVirtualizerRendererAdapter,
} from "../transcript-renderer-adapter.js";

function defineRect(element: HTMLElement, rect: { top: number; bottom: number }): void {
	element.getBoundingClientRect = () => {
		return {
			x: 0,
			y: rect.top,
			width: 100,
			height: rect.bottom - rect.top,
			top: rect.top,
			right: 100,
			bottom: rect.bottom,
			left: 0,
			toJSON: () => "",
		};
	};
}

describe("TranscriptRendererAdapter", () => {
	it("normalizes TanStack Virtual viewport measurement", () => {
		const adapter = createTranscriptVirtualizerRendererAdapter({
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

	it("reports missing TanStack Virtual target instead of scrolling fallback by itself", () => {
		const scrollToIndex = vi.fn();
		const adapter = createTranscriptVirtualizerRendererAdapter({
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

	it("preserves horizontal panel-row position around TanStack Virtual reveal writes", () => {
		const deck = document.createElement("div");
		const container = document.createElement("div");
		deck.appendChild(container);
		Object.defineProperty(deck, "clientWidth", {
			configurable: true,
			value: 300,
		});
		Object.defineProperty(deck, "scrollWidth", {
			configurable: true,
			value: 900,
		});
		Object.defineProperty(deck, "scrollLeft", {
			configurable: true,
			writable: true,
			value: 120,
		});
		const scrollToIndex = vi.fn(() => {
			deck.scrollLeft = 480;
		});
		const adapter = createTranscriptVirtualizerRendererAdapter({
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
			getContainer: () => container,
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
			type: "applied",
			effectType: "RevealRow",
		});
		expect(scrollToIndex).toHaveBeenCalledWith(0, { align: "end" });
		expect(deck.scrollLeft).toBe(120);
	});

	it("reveals TanStack Virtual rows through the row index without scanning row keys", () => {
		const scrollToIndex = vi.fn();
		const adapter = createTranscriptVirtualizerRendererAdapter({
			getHandle: () => {
				return {
					getScrollOffset: () => 0,
					getScrollSize: () => 900,
					getViewportSize: () => 300,
					scrollToIndex,
					scrollTo: vi.fn(),
				};
			},
			getRowKeys: () => {
				throw new Error("must not scan row keys");
			},
			getRowIndex: (rowKey) => (rowKey === "target-row" ? 7 : -1),
		});

		expect(
			adapter.revealRow({
				type: "RevealRow",
				sessionId: "session-1",
				generation: 0,
				targetKey: "target-row",
				align: "center",
				reason: "explicit-reveal",
			})
		).toEqual({
			type: "applied",
			effectType: "RevealRow",
		});
		expect(scrollToIndex).toHaveBeenCalledWith(7, { align: "center" });
	});

	it("measures missing TanStack Virtual anchors through the row index without scanning row keys", () => {
		const adapter = createTranscriptVirtualizerRendererAdapter({
			getHandle: () => {
				return {
					getScrollOffset: () => 240,
					getScrollSize: () => 900,
					getViewportSize: () => 300,
					scrollToIndex: vi.fn(),
					scrollTo: vi.fn(),
				};
			},
			getRowKeys: () => {
				throw new Error("must not scan row keys");
			},
			getRowIndex: (rowKey) => (rowKey === "target-row" ? 7 : -1),
		});

		expect(adapter.measureAnchor("target-row")).toEqual({
			type: "measured",
			anchorKey: "target-row",
			offsetPx: 240,
		});
	});

	it("treats a null TanStack Virtual handle as temporarily missing during teardown", () => {
		const adapter = createTranscriptVirtualizerRendererAdapter({
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

	it("reveals native rows by writing only the transcript container vertical scroll", () => {
		const container = document.createElement("div");
		const row = document.createElement("div");
		let scrollTop = 200;
		Object.defineProperty(container, "scrollTop", {
			configurable: true,
			get: () => scrollTop,
			set: (value: number) => {
				scrollTop = value;
			},
		});
		defineRect(container, { top: 100, bottom: 300 });
		defineRect(row, { top: 260, bottom: 360 });
		vi.spyOn(row, "scrollIntoView").mockImplementation(() => {
			throw new Error("native transcript reveal must not scroll DOM ancestors");
		});

		const adapter = createNativeTranscriptRendererAdapter({
			getContainer: () => container,
			getRowKeys: () => ["row-1"],
			getRowElement: () => row,
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
			type: "applied",
			effectType: "RevealRow",
		});
		expect(scrollTop).toBe(260);
		expect(row.scrollIntoView).not.toHaveBeenCalled();
	});

	it("captures the first visible native anchor instead of the first row key", () => {
		const container = document.createElement("div");
		const rowAbove = document.createElement("div");
		const firstVisible = document.createElement("div");
		const secondVisible = document.createElement("div");
		defineRect(container, { top: 100, bottom: 300 });
		defineRect(rowAbove, { top: 20, bottom: 90 });
		defineRect(firstVisible, { top: 112, bottom: 150 });
		defineRect(secondVisible, { top: 180, bottom: 220 });

		const rows = new Map<string, HTMLElement>([
			["row-above", rowAbove],
			["first-visible", firstVisible],
			["second-visible", secondVisible],
		]);
		const adapter = createNativeTranscriptRendererAdapter({
			getContainer: () => container,
			getRowKeys: () => ["row-above", "first-visible", "second-visible"],
			getRowElement: (rowKey) => rows.get(rowKey) ?? null,
		});

		expect(adapter.captureAnchor()).toEqual({
			type: "captured",
			anchorKey: "first-visible",
			offsetPx: 12,
		});
	});

	it("captures the first visible TanStack Virtual anchor when row elements are available", () => {
		const container = document.createElement("div");
		const rowAbove = document.createElement("div");
		const firstVisible = document.createElement("div");
		defineRect(container, { top: 200, bottom: 500 });
		defineRect(rowAbove, { top: 120, bottom: 180 });
		defineRect(firstVisible, { top: 236, bottom: 280 });

		const rows = new Map<string, HTMLElement>([
			["row-above", rowAbove],
			["first-visible", firstVisible],
		]);
		const adapter = createTranscriptVirtualizerRendererAdapter({
			getHandle: () => {
				return {
					getScrollOffset: () => 900,
					getScrollSize: () => 1200,
					getViewportSize: () => 300,
					scrollToIndex: vi.fn(),
					scrollTo: vi.fn(),
				};
			},
			getRowKeys: () => ["row-above", "first-visible"],
			getContainer: () => container,
			getRowElement: (rowKey) => rows.get(rowKey) ?? null,
		});

		expect(adapter.captureAnchor()).toEqual({
			type: "captured",
			anchorKey: "first-visible",
			offsetPx: 36,
		});
	});
});
