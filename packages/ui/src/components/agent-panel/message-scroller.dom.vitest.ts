import { cleanup, fireEvent, render } from "@testing-library/svelte";
import { createRawSnippet } from "svelte";
import { afterEach, describe, expect, it, vi } from "vitest";

import MessageScroller from "./message-scroller.svelte";
import type { MessageScrollerItem } from "./message-scroller-types.js";
import type { StickToBottomController } from "./stick-to-bottom-effects.js";

// Resolve the real client build of Svelte for component mounting (precedent:
// review-workspace.dom.vitest.ts). happy-dom has no layout engine, so this
// covers DOM structure, attributes, and event-driven follow state — not pixels.
vi.mock("svelte", async () => {
	const { createRequire } = await import("node:module");
	const { dirname, join } = await import("node:path");
	const require = createRequire(import.meta.url);
	const svelteClientPath = join(dirname(require.resolve("svelte/package.json")), "src/index-client.js");
	return import(/* @vite-ignore */ svelteClientPath);
});

afterEach(() => cleanup());

function item(over: Partial<MessageScrollerItem> & Pick<MessageScrollerItem, "key" | "rowId">): MessageScrollerItem {
	return {
		key: over.key,
		rowId: over.rowId,
		estimatePx: over.estimatePx ?? 100,
		isActiveTail: over.isActiveTail ?? false,
		anchorEligible: over.anchorEligible ?? true,
	};
}

const dot = createRawSnippet(() => ({ render: () => "<span>·</span>" }));

type RenderExtra = {
	onFollowStateChange?: (s: { released: boolean; hasUnreadBelow: boolean }) => void;
	onEdgeStateChange?: (s: { atTop: boolean; atBottom: boolean }) => void;
	onReady?: (c: StickToBottomController) => void;
};

function renderScroller(items: MessageScrollerItem[], extra: RenderExtra = {}) {
	return render(MessageScroller, {
		props: {
			items,
			renderItem: dot,
			ariaLabel: "Conversation transcript",
			jumpToLatestLabel: "Jump to latest",
			onFollowStateChange: extra.onFollowStateChange,
			onEdgeStateChange: extra.onEdgeStateChange,
			onReady: extra.onReady,
		},
	});
}

function stubMetrics(el: HTMLElement, scrollHeight: number, clientHeight: number): void {
	Object.defineProperty(el, "scrollHeight", { value: scrollHeight, configurable: true });
	Object.defineProperty(el, "clientHeight", { value: clientHeight, configurable: true });
}

function viewportOf(container: HTMLElement): HTMLElement {
	const el = container.querySelector<HTMLElement>(".message-scroller__viewport");
	if (!el) throw new Error("viewport not found");
	return el;
}

describe("MessageScroller", () => {
	it("renders every row as real DOM in canonical order", () => {
		const items = [
			item({ key: "r1:v1", rowId: "r1" }),
			item({ key: "r2:v1", rowId: "r2" }),
			item({ key: "r3:v1", rowId: "r3" }),
		];
		const { container } = renderScroller(items);
		const ids = Array.from(container.querySelectorAll("[data-row-id]")).map((n) =>
			n.getAttribute("data-row-id")
		);
		expect(ids).toEqual(["r1", "r2", "r3"]);
	});

	it("opts the active streaming tail out of content-visibility skipping", () => {
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
		expect(container.querySelector('[data-row-id="r1"]')?.hasAttribute("data-anchor")).toBe(true);
		expect(container.querySelector('[data-row-id="r2"]')?.hasAttribute("data-anchor")).toBe(false);
	});

	it("hides the jump-to-latest control while following, shows it on user scroll-away", async () => {
		const states: Array<{ released: boolean; hasUnreadBelow: boolean }> = [];
		const items = [item({ key: "r1:v1", rowId: "r1" })];
		const { container } = renderScroller(items, {
			onFollowStateChange: (s) => states.push(s),
		});
		expect(container.querySelector(".message-scroller__jump")).toBeNull();

		const viewport = viewportOf(container);
		stubMetrics(viewport, 2000, 1000);
		viewport.scrollTop = 200;
		await fireEvent.scroll(viewport);

		expect(container.querySelector(".message-scroller__jump")).not.toBeNull();
		expect(container.querySelector(".message-scroller__scrollbar")).not.toBeNull();
		expect(states.at(-1)?.released).toBe(true);
	});

	it("keeps the jump-to-latest control icon-only with an accessible name", async () => {
		const items = [item({ key: "r1:v1", rowId: "r1" })];
		const { container } = renderScroller(items);
		const viewport = viewportOf(container);
		stubMetrics(viewport, 2000, 1000);
		viewport.scrollTop = 200;
		await fireEvent.scroll(viewport);

		const jump = container.querySelector(".message-scroller__jump");
		expect(jump?.textContent?.trim()).toBe("");
		expect(jump?.getAttribute("aria-label")).toBe("Jump to latest");
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

	it("reports edge state and lets the host scroll to top", async () => {
		const edges: Array<{ atTop: boolean; atBottom: boolean }> = [];
		let controller: StickToBottomController | undefined;
		const { container } = renderScroller([item({ key: "r1:v1", rowId: "r1" })], {
			onReady: (c) => {
				controller = c;
			},
			onEdgeStateChange: (s) => edges.push(s),
		});
		const viewport = viewportOf(container);
		stubMetrics(viewport, 2000, 1000);
		viewport.scrollTop = 400;
		await fireEvent.scroll(viewport);

		expect(edges.at(-1)).toEqual({ atTop: false, atBottom: false });
		if (controller === undefined) {
			throw new Error("MessageScroller did not provide a controller");
		}
		controller.scrollToTop();

		expect(viewport.scrollTop).toBe(0);
		expect(edges.at(-1)).toEqual({ atTop: true, atBottom: false });
	});
});
