import { describe, expect, test } from "bun:test";

import {
	measurePreSessionWorktreeHeaderWidth,
	watchPreSessionWorktreeHeaderWidth,
} from "./pre-session-worktree-card-effects.js";

class FakeResizeObserver {
	static callback: ResizeObserverCallback | null = null;
	static observed: Element | null = null;
	static disconnected = false;

	constructor(callback: ResizeObserverCallback) {
		FakeResizeObserver.callback = callback;
		FakeResizeObserver.disconnected = false;
	}

	observe(element: Element) {
		FakeResizeObserver.observed = element;
	}

	unobserve() {}

	disconnect() {
		FakeResizeObserver.disconnected = true;
	}
}

function createHeader(width: number): HTMLElement {
	return {
		getBoundingClientRect: () => ({ width }),
	} as HTMLElement;
}

describe("pre-session worktree card effects", () => {
	test("measures and rounds up the header width", () => {
		expect(measurePreSessionWorktreeHeaderWidth(createHeader(120.2))).toBe(121);
		expect(measurePreSessionWorktreeHeaderWidth(createHeader(0))).toBeNull();
		expect(measurePreSessionWorktreeHeaderWidth(null)).toBeNull();
	});

	test("watches header width while collapsed", () => {
		const widths: number[] = [];
		const header = createHeader(88.4);
		const cleanup = watchPreSessionWorktreeHeaderWidth({
			header,
			isExpanded: false,
			onWidth: (width) => widths.push(width),
			resizeObserver: FakeResizeObserver,
		});

		expect(widths).toEqual([89]);
		expect(FakeResizeObserver.observed).toBe(header);

		FakeResizeObserver.callback?.([], {} as ResizeObserver);
		expect(widths).toEqual([89, 89]);

		cleanup();
		expect(FakeResizeObserver.disconnected).toBe(true);
	});

	test("does not update width while expanded", () => {
		const widths: number[] = [];

		watchPreSessionWorktreeHeaderWidth({
			header: createHeader(88.4),
			isExpanded: true,
			onWidth: (width) => widths.push(width),
			resizeObserver: FakeResizeObserver,
		});

		FakeResizeObserver.callback?.([], {} as ResizeObserver);
		expect(widths).toEqual([]);
	});
});
