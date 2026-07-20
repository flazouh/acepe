import { cleanup, render } from "@testing-library/svelte";
import { createRawSnippet, tick, type Snippet } from "svelte";
import { afterEach, describe, expect, it, vi } from "vitest";

import MessageScroller from "./message-scroller.svelte";
import MessageScrollerContentHarness from "./__tests__/fixtures/message-scroller-content-harness.svelte";
import type { MessageScrollerItem } from "./message-scroller-types.js";
import type { MessageScrollerRangeState } from "./message-scroller-types.js";
import type { AgentPanelPerformanceRecorder } from "./agent-panel-performance-profile.js";
import type { StickToBottomController } from "./stick-to-bottom-effects.js";

// Resolve the real client build of Svelte for component mounting (precedent:
// review-workspace.dom.vitest.ts). happy-dom has no layout engine, so this
// covers DOM structure, attributes, and event-driven follow state — not pixels.
vi.mock("svelte", async () => {
	const { createRequire } = await import("node:module");
	const { dirname, join } = await import("node:path");
	const require = createRequire(import.meta.url);
	const svelteClientPath = join(
		dirname(require.resolve("svelte/package.json")),
		"src/index-client.js",
	);
	return import(/* @vite-ignore */ svelteClientPath);
});

afterEach(() => {
	cleanup();
	resetQueuedFrames();
	vi.restoreAllMocks();
	vi.unstubAllGlobals();
});

function item(
	over: Partial<MessageScrollerItem> &
		Pick<MessageScrollerItem, "key" | "rowId">,
): MessageScrollerItem {
	return {
		key: over.key,
		rowId: over.rowId,
		estimatePx: over.estimatePx ?? 100,
		isActiveTail: over.isActiveTail ?? false,
		anchorEligible: over.anchorEligible ?? true,
	};
}

const dot = createRawSnippet(() => ({ render: () => "<span>·</span>" }));
const fullRow = createRawSnippet<[MessageScrollerItem]>((currentItem) => ({
	render: () => `<span data-testid="full-row">${currentItem().rowId}</span>`,
}));

type RenderExtra = {
	onFollowStateChange?: (s: {
		released: boolean;
		hasUnreadBelow: boolean;
	}) => void;
	onEdgeStateChange?: (s: { atTop: boolean; atBottom: boolean }) => void;
	onVisibleRangeChange?: (s: MessageScrollerRangeState) => void;
	onReady?: (c: StickToBottomController) => void;
	profileRecorder?: AgentPanelPerformanceRecorder;
	renderItem?: Snippet<[MessageScrollerItem]>;
	virtualLeadingSpacePx?: number;
};

function renderScroller(items: MessageScrollerItem[], extra: RenderExtra = {}) {
	return render(MessageScroller, {
		props: {
			items,
			renderItem: extra.renderItem ?? dot,
			ariaLabel: "Conversation transcript",
			onFollowStateChange: extra.onFollowStateChange,
			onEdgeStateChange: extra.onEdgeStateChange,
				onVisibleRangeChange: extra.onVisibleRangeChange,
				onReady: extra.onReady,
				profileRecorder: extra.profileRecorder,
				virtualLeadingSpacePx: extra.virtualLeadingSpacePx,
			},
		});
	}

function manyItems(count: number): MessageScrollerItem[] {
	const rows: MessageScrollerItem[] = [];
	for (let index = 0; index < count; index += 1) {
		rows.push(
			item({ key: `row-${index}:v1`, rowId: `row-${index}`, estimatePx: 100 }),
		);
	}
	return rows;
}

function domRect(input: { readonly top: number; readonly bottom: number }): DOMRect {
	return {
		x: 0,
		y: input.top,
		width: 100,
		height: input.bottom - input.top,
		top: input.top,
		right: 100,
		bottom: input.bottom,
		left: 0,
		toJSON: () => ({}),
	} as DOMRect;
}

function stubMetrics(
	el: HTMLElement,
	scrollHeight: number,
	clientHeight: number,
): void {
	Object.defineProperty(el, "scrollTop", {
		value: 0,
		writable: true,
		configurable: true,
	});
	Object.defineProperty(el, "scrollHeight", {
		value: scrollHeight,
		configurable: true,
	});
	Object.defineProperty(el, "clientHeight", {
		value: clientHeight,
		configurable: true,
	});
}

function viewportOf(container: HTMLElement): HTMLElement {
	const el = container.querySelector<HTMLElement>(
		".message-scroller__viewport",
	);
	if (!el) throw new Error("viewport not found");
	return el;
}

class FakeResizeObserver {
	static instances: FakeResizeObserver[] = [];
	static observed: Element[] = [];
	readonly observed: Element[] = [];
	readonly callback: ResizeObserverCallback;

	constructor(callback: ResizeObserverCallback) {
		this.callback = callback;
		FakeResizeObserver.instances.push(this);
	}

	observe(element: Element): void {
		this.observed.push(element);
		FakeResizeObserver.observed.push(element);
	}

	disconnect(): void {
		this.observed.length = 0;
	}

	static reset(): void {
		FakeResizeObserver.instances = [];
		FakeResizeObserver.observed = [];
	}

	static entryFor(target: Element, heightPx: number): ResizeObserverEntry {
		return {
			target,
			contentRect: {
				height: heightPx,
			} as DOMRectReadOnly,
			contentBoxSize: [
				{
					blockSize: heightPx,
					inlineSize: 100,
				},
			],
			borderBoxSize: [],
			devicePixelContentBoxSize: [],
		} as ResizeObserverEntry;
	}

	static emitHeightFor(target: Element, heightPx: number): void {
		for (const instance of FakeResizeObserver.instances) {
			if (!instance.observed.includes(target)) {
				continue;
			}
			instance.callback(
				[FakeResizeObserver.entryFor(target, heightPx)],
				{} as ResizeObserver,
			);
		}
	}

	static emitHeight(heightPx: number): void {
		for (const instance of FakeResizeObserver.instances) {
			const entries = instance.observed.map((target) =>
				FakeResizeObserver.entryFor(target, heightPx),
			);
			instance.callback(entries, {} as ResizeObserver);
		}
	}
}

type QueuedFrame = {
	readonly id: number;
	readonly callback: FrameRequestCallback;
	canceled: boolean;
};

let queuedFrameId = 0;
let queuedFrames: QueuedFrame[] = [];

function queuedAnimationFrame(callback: FrameRequestCallback): number {
	queuedFrameId += 1;
	queuedFrames.push({
		id: queuedFrameId,
		callback,
		canceled: false,
	});
	return queuedFrameId;
}

function cancelQueuedAnimationFrame(handle: number): void {
	for (const frame of queuedFrames) {
		if (frame.id === handle) {
			frame.canceled = true;
		}
	}
}

function resetQueuedFrames(): void {
	queuedFrameId = 0;
	queuedFrames = [];
}

async function flushQueuedFrame(): Promise<void> {
	const frames = queuedFrames;
	queuedFrames = [];
	for (const frame of frames) {
		if (!frame.canceled) {
			frame.callback(performance.now());
		}
	}
	await tick();
}

function rowElement(container: HTMLElement, rowId: string): HTMLElement {
	const row = container.querySelector<HTMLElement>(`[data-row-id="${rowId}"]`);
	if (row === null) {
		throw new Error(`row ${rowId} not found`);
	}
	return row;
}

function rowShellTransform(container: HTMLElement, rowId: string): string {
	const row = rowElement(container, rowId);
	const shell = row.parentElement as HTMLElement | null;
	if (shell === null) {
		throw new Error(`row ${rowId} shell not found`);
	}
	return shell.style.transform;
}

function rowNumber(rowId: string | null | undefined): number {
	if (rowId === null || rowId === undefined) {
		throw new Error("row id missing");
	}
	const value = Number(rowId.replace("row-", ""));
	if (!Number.isFinite(value)) {
		throw new Error(`row id is not numeric: ${rowId}`);
	}
	return value;
}

describe("MessageScroller", () => {
	it("renders every row as real DOM in canonical order", () => {
		const items = [
			item({ key: "r1:v1", rowId: "r1" }),
			item({ key: "r2:v1", rowId: "r2" }),
			item({ key: "r3:v1", rowId: "r3" }),
		];
		const { container } = renderScroller(items);
		const ids = Array.from(container.querySelectorAll("[data-row-id]")).map(
			(n) => n.getAttribute("data-row-id"),
		);
		expect(ids).toEqual(["r1", "r2", "r3"]);
	});

	it("marks the active streaming tail row", () => {
		const items = [
			item({ key: "r1:v1", rowId: "r1" }),
			item({ key: "tail:v1", rowId: "tail", isActiveTail: true }),
		];
		const { container } = renderScroller(items);
		const tail = container.querySelector('[data-row-id="tail"]');
		const normal = container.querySelector('[data-row-id="r1"]');
		expect(tail?.classList.contains("is-active-tail")).toBe(true);
		expect(normal?.classList.contains("is-active-tail")).toBe(false);
	});

	it("marks anchor-eligible rows with data-anchor", () => {
		const items = [
			item({ key: "r1:v1", rowId: "r1", anchorEligible: true }),
			item({ key: "r2:v1", rowId: "r2", anchorEligible: false }),
		];
		const { container } = renderScroller(items);
		expect(
			container
				.querySelector('[data-row-id="r1"]')
				?.hasAttribute("data-anchor"),
		).toBe(true);
		expect(
			container
				.querySelector('[data-row-id="r2"]')
				?.hasAttribute("data-anchor"),
		).toBe(false);
	});

	it("reports released state on user scroll-away without local scroll affordances", async () => {
		const states: Array<{ released: boolean; hasUnreadBelow: boolean }> = [];
		const items = [item({ key: "r1:v1", rowId: "r1" })];
		const { container } = renderScroller(items, {
			onFollowStateChange: (s) => states.push(s),
		});
		expect(container.querySelector(".message-scroller__jump")).toBeNull();
		expect(container.querySelector(".message-scroller__scrollbar")).toBeNull();

		const viewport = viewportOf(container);
		stubMetrics(viewport, 2000, 1000);
		viewport.dispatchEvent(new WheelEvent("wheel", { deltaY: -200 }));
		viewport.scrollTop = 200;
		viewport.dispatchEvent(new Event("scroll"));

		expect(container.querySelector(".message-scroller__jump")).toBeNull();
		expect(container.querySelector(".message-scroller__scrollbar")).toBeNull();
		expect(states.at(-1)?.released).toBe(true);
	});

	it("exposes the controller via onReady", () => {
		let ready = false;
		renderScroller([item({ key: "r1:v1", rowId: "r1" })], {
			onReady: (c) => {
				ready =
					typeof c.jumpToLatest === "function" &&
					typeof c.openAt === "function" &&
					typeof c.scrollToTop === "function";
			},
		});
		expect(ready).toBe(true);
	});

	it("keeps one controller instance across source rerenders", async () => {
		let readyCount = 0;
		let firstController: StickToBottomController | undefined;
		const view = renderScroller(manyItems(300), {
			onReady: (c) => {
				readyCount += 1;
				if (firstController === undefined) {
					firstController = c;
				}
			},
		});

		await view.rerender({
			items: manyItems(500),
			renderItem: dot,
			ariaLabel: "Conversation transcript",
		});

		expect(readyCount).toBe(1);
		expect(firstController).toBeDefined();
	});

	it("reuses a flow row shell when only its render version changes", async () => {
		let controller: StickToBottomController | undefined;
		const view = render(MessageScrollerContentHarness, {
			props: {
				items: [item({ key: "assistant:v1", rowId: "assistant", estimatePx: 150 })],
				onReady: (readyController: StickToBottomController) => {
					controller = readyController;
				},
			},
		});
		const viewport = viewportOf(view.container);
		stubMetrics(viewport, 2_000, 800);
		if (controller === undefined) {
			throw new Error("MessageScroller did not provide a controller");
		}
		controller.onSend();
		const originalShell = rowElement(view.container, "assistant").parentElement;
		expect(
			view.container.querySelector('[data-testid="versioned-row-content"]')?.textContent,
		).toBe("content assistant:v1");

		await view.rerender({
			items: [
				item({
					key: "assistant:v2",
					rowId: "assistant",
					estimatePx: 180,
					isActiveTail: true,
					anchorEligible: false,
				}),
			],
			onReady: (readyController: StickToBottomController) => {
				controller = readyController;
			},
		});

		const updatedRow = rowElement(view.container, "assistant");
		expect(updatedRow.parentElement).toBe(originalShell);
		expect(updatedRow.getAttribute("data-cv-estimate-px")).toBe("180");
		expect(updatedRow.classList.contains("is-active-tail")).toBe(true);
		expect(updatedRow.hasAttribute("data-anchor")).toBe(false);
		expect(
			view.container.querySelector('[data-testid="versioned-row-content"]')?.textContent,
		).toBe("content assistant:v2");
		expect(viewport.scrollHeight - viewport.scrollTop - viewport.clientHeight).toBe(0);
		expect(controller.getState().released).toBe(false);
	});

	it("replaces a flow row shell when row identity changes", async () => {
		const view = renderScroller([item({ key: "assistant:v1", rowId: "assistant" })]);
		const originalShell = rowElement(view.container, "assistant").parentElement;

		await view.rerender({
			items: [item({ key: "replacement:v1", rowId: "replacement" })],
			renderItem: dot,
			ariaLabel: "Conversation transcript",
		});

		expect(rowElement(view.container, "replacement").parentElement).not.toBe(originalShell);
		expect(view.container.querySelector('[data-row-id="assistant"]')).toBeNull();
	});

	it("reacquires bottom on send before the pending user row and stays attached into streaming", async () => {
		FakeResizeObserver.reset();
		vi.stubGlobal("ResizeObserver", FakeResizeObserver);
		vi.stubGlobal("requestAnimationFrame", queuedAnimationFrame);
		vi.stubGlobal("cancelAnimationFrame", cancelQueuedAnimationFrame);
		const followStates: Array<{
			released: boolean;
			hasUnreadBelow: boolean;
		}> = [];
		let controller: StickToBottomController | undefined;
		const existingRows = manyItems(300);
		const pendingUserRow = item({ key: "pending-user:v1", rowId: "pending-user" });
		const streamedAssistantRow = item({
			key: "streaming-assistant:v1",
			rowId: "streaming-assistant",
			isActiveTail: true,
		});
		const view = renderScroller(existingRows, {
			renderItem: fullRow,
			onReady: (readyController) => {
				controller = readyController;
			},
			onFollowStateChange: (state) => {
				followStates.push(state);
			},
		});
		const viewport = viewportOf(view.container);
		let scrollHeightPx = 30_000;
		Object.defineProperty(viewport, "scrollTop", {
			value: 29_200,
			writable: true,
			configurable: true,
		});
		Object.defineProperty(viewport, "scrollHeight", {
			get: () => scrollHeightPx,
			configurable: true,
		});
		Object.defineProperty(viewport, "clientHeight", {
			value: 800,
			configurable: true,
		});
		viewport.dispatchEvent(new WheelEvent("wheel", { deltaY: -200 }));
		viewport.scrollTop = 28_000;
		viewport.dispatchEvent(new Event("scroll"));

		if (controller === undefined) {
			throw new Error("MessageScroller did not provide a controller");
		}
		const readyController = controller;
		expect(readyController.getState().released).toBe(true);
		readyController.onSend();
		expect(readyController.getState().released).toBe(false);
		expect(viewport.scrollTop).toBe(29_200);
		expect(scrollHeightPx - viewport.scrollTop - viewport.clientHeight).toBe(0);
		viewport.dispatchEvent(new Event("scroll"));
		await flushQueuedFrame();

		const pendingRows = existingRows.concat(pendingUserRow);
		const followStateCountBeforeStream = followStates.length;
		await view.rerender({
			items: pendingRows,
			renderItem: fullRow,
			ariaLabel: "Conversation transcript",
		});
		scrollHeightPx = 30_100;
		const content = view.container.querySelector<HTMLElement>(
			".message-scroller__content",
		);
		if (content === null) {
			throw new Error("MessageScroller content was not rendered");
		}
		FakeResizeObserver.emitHeightFor(content, scrollHeightPx);
		await flushQueuedFrame();

		expect(readyController.getState().released).toBe(false);
		expect(scrollHeightPx - viewport.scrollTop - viewport.clientHeight).toBe(0);
		expect(view.container.querySelector('[data-row-id="pending-user"]')).not.toBeNull();
		expect(view.container.querySelector(".message-scroller__send-anchor-spacer")).toBeNull();
		expect(
			view.container.querySelector(
				'[data-row-id="awaiting:planning"], [data-row-id="local:planning"]',
			),
		).toBeNull();

		await view.rerender({
			items: pendingRows.concat(streamedAssistantRow),
			renderItem: fullRow,
			ariaLabel: "Conversation transcript",
		});
		scrollHeightPx = 30_200;
		queueMicrotask(() => readyController.notifyContentChanged());
		await Promise.resolve();
		await flushQueuedFrame();

		expect(readyController.getState().released).toBe(false);
		expect(scrollHeightPx - viewport.scrollTop - viewport.clientHeight).toBe(0);
		expect(followStates.length).toBe(followStateCountBeforeStream);
	});

	it("lets an explicit user scroll after send release and cancel pending-row follow-through", async () => {
		FakeResizeObserver.reset();
		vi.stubGlobal("ResizeObserver", FakeResizeObserver);
		let controller: StickToBottomController | undefined;
		const existingRows = manyItems(300);
		const pendingUserRow = item({ key: "pending-user:v1", rowId: "pending-user" });
		const view = renderScroller(existingRows, {
			onReady: (readyController) => {
				controller = readyController;
			},
		});
		const viewport = viewportOf(view.container);
		let scrollHeightPx = 30_000;
		Object.defineProperty(viewport, "scrollTop", {
			value: 29_200,
			writable: true,
			configurable: true,
		});
		Object.defineProperty(viewport, "scrollHeight", {
			get: () => scrollHeightPx,
			configurable: true,
		});
		Object.defineProperty(viewport, "clientHeight", {
			value: 800,
			configurable: true,
		});
		if (controller === undefined) {
			throw new Error("MessageScroller did not provide a controller");
		}
		controller.onSend();
		expect(controller.getState().released).toBe(false);
		expect(viewport.scrollTop).toBe(29_200);

		viewport.dispatchEvent(new WheelEvent("wheel", { deltaY: -200 }));
		viewport.scrollTop = 28_000;
		viewport.dispatchEvent(new Event("scroll"));
		expect(controller.getState().released).toBe(true);
		expect(viewport.scrollTop).toBe(28_000);

		await view.rerender({
			items: existingRows.concat(pendingUserRow),
			renderItem: dot,
			ariaLabel: "Conversation transcript",
		});
		scrollHeightPx = 30_100;
		const content = view.container.querySelector<HTMLElement>(
			".message-scroller__content",
		);
		if (content === null) {
			throw new Error("MessageScroller content was not rendered");
		}
		FakeResizeObserver.emitHeightFor(content, scrollHeightPx);
		await tick();

		expect(controller.getState().released).toBe(true);
		expect(viewport.scrollTop).toBe(28_000);
	});

	it("reports edge state and lets the host scroll to top", async () => {
		const edges: Array<{ atTop: boolean; atBottom: boolean }> = [];
		let controller: StickToBottomController | undefined;
		const { container } = renderScroller(
			[item({ key: "r1:v1", rowId: "r1" })],
			{
				onReady: (c) => {
					controller = c;
				},
				onEdgeStateChange: (s) => edges.push(s),
			},
		);
		const viewport = viewportOf(container);
		stubMetrics(viewport, 2000, 1000);
		viewport.scrollTop = 400;
		viewport.dispatchEvent(new Event("scroll"));

		expect(edges.at(-1)).toEqual({ atTop: false, atBottom: false });
		if (controller === undefined) {
			throw new Error("MessageScroller did not provide a controller");
		}
		controller.scrollToTop();

		expect(viewport.scrollTop).toBe(0);
		expect(edges.at(-1)).toEqual({ atTop: true, atBottom: false });
	});

	it("virtualizes large transcripts on one transform-positioned plane", () => {
		const { container } = renderScroller(manyItems(1_000));
		const ids = Array.from(container.querySelectorAll("[data-row-id]")).map(
			(n) => n.getAttribute("data-row-id"),
		);
		const content = container.querySelector<HTMLElement>(
			".message-scroller__content",
		);
		const firstShell = container.querySelector<HTMLElement>("[data-virtual-row]");

		expect(ids.length).toBeLessThan(140);
		expect(ids.at(0)).toBe("row-0");
		expect(ids).not.toContain("row-999");
		expect(
			container
				.querySelector('[data-row-id="row-0"]')
				?.getAttribute("data-row-index"),
		).toBe("0");
		expect(content?.classList.contains("is-virtualized")).toBe(true);
		expect(content?.style.height).toBe("100000px");
		expect(firstShell?.style.transform).toBe("translateY(0px)");
		expect(container.querySelector('[data-virtual-spacer="after"]')).toBeNull();
	});

	it("reserves leading virtual space for unloaded history without placeholder rows", () => {
		const { container } = renderScroller(manyItems(10), {
			virtualLeadingSpacePx: 25_000,
		});
		const content = container.querySelector<HTMLElement>(
			".message-scroller__content",
		);

		expect(content?.classList.contains("is-virtualized")).toBe(true);
		expect(content?.style.height).toBe("26000px");
		expect(rowShellTransform(container, "row-0")).toBe(
			"translateY(25000px)",
		);
		expect(container.querySelector(".message-scroller__row-placeholder")).toBeNull();
		expect(container.querySelector('[data-virtual-spacer="before"]')).toBeNull();
	});

	it("keeps scroll content height stable when leading history space becomes real rows", async () => {
		const view = renderScroller(manyItems(1_000), {
			virtualLeadingSpacePx: 20_000,
		});
		const content = view.container.querySelector<HTMLElement>(
			".message-scroller__content",
		);
		expect(content?.style.height).toBe("120000px");

		await view.rerender({
			items: manyItems(1_200),
			renderItem: dot,
			ariaLabel: "Conversation transcript",
			virtualLeadingSpacePx: 0,
		});

		expect(content?.style.height).toBe("120000px");
	});

	it("does not replay a released source anchor after send reacquires the bottom", async () => {
		vi.stubGlobal("requestAnimationFrame", queuedAnimationFrame);
		vi.stubGlobal("cancelAnimationFrame", cancelQueuedAnimationFrame);
		let controller: StickToBottomController | undefined;
		const existingRows = manyItems(300);
		const pendingUserRow = item({ key: "pending-user:v1", rowId: "pending-user" });
		const view = renderScroller(existingRows, {
			onReady: (readyController) => {
				controller = readyController;
			},
		});
		const viewport = viewportOf(view.container);
		let scrollHeightPx = 30_000;
		Object.defineProperty(viewport, "scrollTop", {
			value: 27_000,
			writable: true,
			configurable: true,
		});
		Object.defineProperty(viewport, "scrollHeight", {
			get: () => scrollHeightPx,
			configurable: true,
		});
		Object.defineProperty(viewport, "clientHeight", {
			value: 800,
			configurable: true,
		});
		viewport.dispatchEvent(new WheelEvent("wheel", { deltaY: -200 }));
		viewport.dispatchEvent(new Event("scroll"));
		await flushQueuedFrame();

		if (controller === undefined) {
			throw new Error("MessageScroller did not provide a controller");
		}
		const readyController = controller;
		expect(readyController.getState().released).toBe(true);
		vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(
			function (this: HTMLElement): DOMRect {
				if (this.classList.contains("message-scroller__viewport")) {
					return domRect({ top: 0, bottom: 800 });
				}
				if (this.getAttribute("data-row-id") === "row-271") {
					return domRect({ top: 100, bottom: 200 });
				}
				return domRect({ top: 900, bottom: 1_000 });
			},
		);

		scrollHeightPx = 30_100;
		await view.rerender({
			items: existingRows.concat(pendingUserRow),
			renderItem: dot,
			ariaLabel: "Conversation transcript",
		});
		readyController.onSend();
		expect(readyController.getState().released).toBe(false);
		expect(viewport.scrollTop).toBe(29_300);

		await flushQueuedFrame();

		expect(readyController.getState().released).toBe(false);
		expect(scrollHeightPx - viewport.scrollTop - viewport.clientHeight).toBe(0);
	});

	it("preserves a released reading anchor across an ordinary append without send", async () => {
		vi.stubGlobal("requestAnimationFrame", queuedAnimationFrame);
		vi.stubGlobal("cancelAnimationFrame", cancelQueuedAnimationFrame);
		let controller: StickToBottomController | undefined;
		const existingRows = manyItems(300);
		const appendedRow = item({ key: "appended:v1", rowId: "appended" });
		const view = renderScroller(existingRows, {
			onReady: (readyController) => {
				controller = readyController;
			},
		});
		const viewport = viewportOf(view.container);
		let scrollHeightPx = 30_000;
		Object.defineProperty(viewport, "scrollTop", {
			value: 27_000,
			writable: true,
			configurable: true,
		});
		Object.defineProperty(viewport, "scrollHeight", {
			get: () => scrollHeightPx,
			configurable: true,
		});
		Object.defineProperty(viewport, "clientHeight", {
			value: 800,
			configurable: true,
		});
		viewport.dispatchEvent(new WheelEvent("wheel", { deltaY: -200 }));
		viewport.dispatchEvent(new Event("scroll"));
		await flushQueuedFrame();

		if (controller === undefined) {
			throw new Error("MessageScroller did not provide a controller");
		}
		const readyController = controller;
		expect(readyController.getState().released).toBe(true);
		vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(
			function (this: HTMLElement): DOMRect {
				if (this.classList.contains("message-scroller__viewport")) {
					return domRect({ top: 0, bottom: 800 });
				}
				if (this.getAttribute("data-row-id") === "row-271") {
					return domRect({ top: 100, bottom: 200 });
				}
				return domRect({ top: 900, bottom: 1_000 });
			},
		);

		scrollHeightPx = 30_100;
		await view.rerender({
			items: existingRows.concat(appendedRow),
			renderItem: dot,
			ariaLabel: "Conversation transcript",
		});
		viewport.scrollTop = 28_000;
		await flushQueuedFrame();

		expect(readyController.getState().released).toBe(true);
		expect(viewport.scrollTop).toBe(27_000);
	});

	it("keeps the same anchor row in place when older rows are prepended", async () => {
		const initialItems = manyItems(1_000);
		const olderItems: MessageScrollerItem[] = [];
		for (let index = 0; index < 200; index += 1) {
			olderItems.push(
				item({
					key: `older-${index}:v1`,
					rowId: `older-${index}`,
					estimatePx: 100,
				}),
			);
		}
		const view = renderScroller(initialItems, {
			virtualLeadingSpacePx: 20_000,
		});
		const viewport = viewportOf(view.container);
		stubMetrics(viewport, 120_000, 800);
		viewport.scrollTop = 49_900;
		viewport.dispatchEvent(new WheelEvent("wheel", { deltaY: -200 }));
		viewport.dispatchEvent(new Event("scroll"));
		await tick();

		const rectSpy = vi
			.spyOn(HTMLElement.prototype, "getBoundingClientRect")
			.mockImplementation(function (this: HTMLElement): DOMRect {
				if (this.classList.contains("message-scroller__viewport")) {
					return domRect({ top: 0, bottom: 800 });
				}
				if (this.getAttribute("data-row-id") === "row-300") {
					return domRect({ top: 100, bottom: 200 });
				}
				return domRect({ top: 900, bottom: 1_000 });
			});

		const rerendered = view.rerender({
			items: olderItems.concat(initialItems),
			renderItem: dot,
			ariaLabel: "Conversation transcript",
			virtualLeadingSpacePx: 0,
		});
		viewport.scrollTop = 70_000;
		await rerendered;
		await tick();

		expect(rectSpy).toHaveBeenCalled();
		expect(viewport.scrollTop).toBe(49_900);
	});

	it("updates the virtual window when the viewport scrolls", async () => {
		const { container } = renderScroller(manyItems(1_000));
		const viewport = viewportOf(container);
		stubMetrics(viewport, 100_000, 800);
		await new Promise((resolve) => setTimeout(resolve, 250));

		viewport.scrollTop = 50_000;
		viewport.dispatchEvent(new Event("scroll"));
		await tick();

		const first = container
			.querySelector("[data-row-id]")
			?.getAttribute("data-row-id");
		const firstShell = container.querySelector<HTMLElement>(
			"[data-virtual-row]",
		);
		const firstIndex = rowNumber(first);
		expect(firstIndex).toBeGreaterThanOrEqual(470);
		expect(firstIndex).toBeLessThanOrEqual(500);
		expect(firstShell?.style.transform).toBe(
			`translateY(${firstIndex * 100}px)`,
		);
		expect(container.querySelector('[data-virtual-spacer="before"]')).toBeNull();
		expect(container.querySelector(".message-scroller__row-placeholder")).toBeNull();
	});

	it("reports visible range state as the virtual window moves", async () => {
		const ranges: MessageScrollerRangeState[] = [];
		const { container } = renderScroller(manyItems(1_000), {
			onVisibleRangeChange: (state) => ranges.push(state),
		});
		const viewport = viewportOf(container);
		stubMetrics(viewport, 100_000, 800);
		await tick();

		const initialRange = ranges.at(-1);
		expect(initialRange?.startIndex).toBe(0);
		expect(initialRange?.endIndex).toBeGreaterThan(10);
		expect(initialRange?.endIndex).toBeLessThan(40);
		expect(initialRange?.itemCount).toBe(1_000);
		expect(initialRange?.beforePx).toBe(0);
		expect(initialRange?.totalPx).toBe(100_000);
		expect(initialRange?.isVirtualized).toBe(true);

		viewport.scrollTop = 50_000;
		viewport.dispatchEvent(new Event("scroll"));
		await tick();

		const scrolledRange = ranges.at(-1);
		expect(scrolledRange?.startIndex).toBeGreaterThanOrEqual(470);
		expect(scrolledRange?.startIndex).toBeLessThanOrEqual(500);
		expect(scrolledRange?.endIndex).toBeGreaterThan(scrolledRange?.startIndex ?? 0);
		expect(scrolledRange?.itemCount).toBe(1_000);
		expect(scrolledRange?.beforePx).toBeGreaterThan(47_000);
		expect(scrolledRange?.afterPx).toBeGreaterThan(40_000);
		expect(scrolledRange?.totalPx).toBe(100_000);
		expect(scrolledRange?.isVirtualized).toBe(true);
	});

	it("resolves an unmounted row for openAt", () => {
		let controller: StickToBottomController | undefined;
		const { container } = renderScroller(manyItems(1_000), {
			onReady: (c) => {
				controller = c;
			},
		});
		const viewport = viewportOf(container);
		stubMetrics(viewport, 100_000, 800);
		if (controller === undefined) {
			throw new Error("MessageScroller did not provide a controller");
		}

		controller.openAt("row-300", 0);

		expect(viewport.scrollTop).toBe(30_000);
	});

	it("includes leading virtual space when resolving an openAt row", () => {
		let controller: StickToBottomController | undefined;
		const { container } = renderScroller(manyItems(10), {
			onReady: (c) => {
				controller = c;
			},
			virtualLeadingSpacePx: 20_000,
		});
		const viewport = viewportOf(container);
		stubMetrics(viewport, 30_000, 800);
		if (controller === undefined) {
			throw new Error("MessageScroller did not provide a controller");
		}

		controller.openAt("row-3", 0);

		expect(viewport.scrollTop).toBe(20_200);
	});

	it("uses ResizeObserver row heights without synchronous row rect reads", async () => {
		FakeResizeObserver.reset();
		vi.stubGlobal("ResizeObserver", FakeResizeObserver);
		const rectSpy = vi.spyOn(HTMLElement.prototype, "getBoundingClientRect");

		renderScroller(manyItems(1_000));

		expect(rectSpy).not.toHaveBeenCalled();
		FakeResizeObserver.emitHeight(112);
		await tick();

		expect(rectSpy).not.toHaveBeenCalled();
	});

	it("uses measured row height as the next row estimate", async () => {
		FakeResizeObserver.reset();
		vi.stubGlobal("ResizeObserver", FakeResizeObserver);
		vi.stubGlobal("requestAnimationFrame", queuedAnimationFrame);
		vi.stubGlobal("cancelAnimationFrame", cancelQueuedAnimationFrame);
		const { container } = renderScroller(manyItems(1_000));
		const row = rowElement(container, "row-0");

		expect(row.getAttribute("data-cv-estimate-px")).toBe("100");
		expect(row.getAttribute("data-cv-estimate-source")).toBe("static");
		FakeResizeObserver.emitHeightFor(row, 144);
		await flushQueuedFrame();

		expect(row.getAttribute("data-cv-estimate-px")).toBe("144");
		expect(row.getAttribute("data-cv-estimate-source")).toBe("measured");
		expect(row.getAttribute("data-measured-height-px")).toBe("144");
		expect(row.getAttribute("data-static-estimate-error-px")).toBe("44");
	});

	it("repositions following virtual rows after a row height measurement changes", async () => {
		FakeResizeObserver.reset();
		vi.stubGlobal("ResizeObserver", FakeResizeObserver);
		vi.stubGlobal("requestAnimationFrame", queuedAnimationFrame);
		vi.stubGlobal("cancelAnimationFrame", cancelQueuedAnimationFrame);
		const { container } = renderScroller(manyItems(1_000));
		const row = rowElement(container, "row-0");

		expect(rowShellTransform(container, "row-1")).toBe("translateY(100px)");
		FakeResizeObserver.emitHeightFor(row, 144);
		await flushQueuedFrame();

		expect(rowElement(container, "row-0").getAttribute("data-cv-estimate-px")).toBe("144");
		expect(rowShellTransform(container, "row-1")).toBe("translateY(144px)");
	});

	it("pauses measured row height observation while the viewport is scrolling", async () => {
		FakeResizeObserver.reset();
		vi.stubGlobal("ResizeObserver", FakeResizeObserver);
		vi.stubGlobal("requestAnimationFrame", queuedAnimationFrame);
		vi.stubGlobal("cancelAnimationFrame", cancelQueuedAnimationFrame);
		const { container } = renderScroller(manyItems(1_000));
		const viewport = viewportOf(container);
		stubMetrics(viewport, 100_000, 800);
		expect(FakeResizeObserver.observed).toContain(rowElement(container, "row-0"));

		viewport.scrollTop = 300;
		viewport.dispatchEvent(new Event("scroll"));
		await tick();
		const row = rowElement(container, "row-0");
		FakeResizeObserver.emitHeightFor(row, 144);
		await flushQueuedFrame();

		expect(rowElement(container, "row-0").getAttribute("data-cv-estimate-px")).toBe("100");

		await new Promise((resolve) => setTimeout(resolve, 180));
		await tick();
		FakeResizeObserver.emitHeightFor(rowElement(container, "row-0"), 144);
		await flushQueuedFrame();

		expect(rowElement(container, "row-0").getAttribute("data-cv-estimate-px")).toBe("144");
	});

	it("keeps visible real rows mounted during fast scroll jumps", async () => {
		FakeResizeObserver.reset();
		vi.stubGlobal("ResizeObserver", FakeResizeObserver);
		vi.stubGlobal("requestAnimationFrame", queuedAnimationFrame);
		vi.stubGlobal("cancelAnimationFrame", cancelQueuedAnimationFrame);
		const { container } = renderScroller(manyItems(1_000), {
			renderItem: fullRow,
		});
		const viewport = viewportOf(container);
		stubMetrics(viewport, 100_000, 800);

		viewport.scrollTop = 1_300;
		viewport.dispatchEvent(new Event("scroll"));
		await tick();

		const visibleRow = rowElement(container, "row-13");
		expect(visibleRow.querySelector('[data-testid="full-row"]')?.textContent).toBe(
			"row-13",
		);
		expect(visibleRow.querySelector("[data-deferred-row-content]")).toBeNull();
		expect(container.querySelector("[data-deferred-row-content]")).toBeNull();
	});

	it("ignores stale measured height when the item key changes", async () => {
		FakeResizeObserver.reset();
		vi.stubGlobal("ResizeObserver", FakeResizeObserver);
		vi.stubGlobal("requestAnimationFrame", queuedAnimationFrame);
		vi.stubGlobal("cancelAnimationFrame", cancelQueuedAnimationFrame);
		const initialItems = manyItems(1_000);
		const view = renderScroller(initialItems);
		const row = rowElement(view.container, "row-0");
		FakeResizeObserver.emitHeightFor(row, 144);
		await flushQueuedFrame();
		expect(rowElement(view.container, "row-0").getAttribute("data-cv-estimate-px")).toBe(
			"144",
		);

		const nextItems = initialItems.map((currentItem, index) =>
			index === 0
				? item({ key: "row-0:v2", rowId: "row-0", estimatePx: 100 })
				: currentItem,
		);
		await view.rerender({
			items: nextItems,
			renderItem: dot,
			ariaLabel: "Conversation transcript",
		});

		expect(rowElement(view.container, "row-0").getAttribute("data-cv-estimate-px")).toBe(
			"100",
		);
	});

	it("keeps real rows rendered while a virtualized viewport is actively scrolling", async () => {
		vi.useFakeTimers();
		const { container } = renderScroller(manyItems(1_000), {
			renderItem: fullRow,
		});
		const viewport = viewportOf(container);
		stubMetrics(viewport, 100_000, 800);

		expect(container.querySelector('[data-testid="full-row"]')).not.toBeNull();

		viewport.scrollTop = 50_000;
		viewport.dispatchEvent(new Event("scroll"));
		await tick();

		expect(container.querySelector('[data-testid="full-row"]')).not.toBeNull();

		await vi.advanceTimersByTimeAsync(160);
		await tick();

		expect(container.querySelector('[data-testid="full-row"]')).not.toBeNull();
	});
});
