import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { getScrollEventTargets, observeScrollParents } from "../logic/scroll-sync.js";

describe("browser panel scroll sync", () => {
	beforeEach(() => {
		const windowScrollHandlers = new Set<EventListenerOrEventListenerObject>();
		Object.defineProperty(window, "getComputedStyle", {
			value: (element: HTMLElement) => ({
				overflowX: element.style.overflowX,
				overflowY: element.style.overflowY,
			}),
			configurable: true,
			writable: true,
		});
		Object.defineProperty(window, "addEventListener", {
			value: (type: string, listener: EventListenerOrEventListenerObject) => {
				if (type === "scroll") {
					windowScrollHandlers.add(listener);
				}
			},
			configurable: true,
			writable: true,
		});
		Object.defineProperty(window, "removeEventListener", {
			value: (type: string, listener: EventListenerOrEventListenerObject) => {
				if (type === "scroll") {
					windowScrollHandlers.delete(listener);
				}
			},
			configurable: true,
			writable: true,
		});
		Object.defineProperty(window, "dispatchEvent", {
			value: (event: Event) => {
				if (event.type !== "scroll") {
					return true;
				}
				for (const listener of windowScrollHandlers) {
					if (typeof listener === "function") {
						listener.call(window, event);
					} else {
						listener.handleEvent(event);
					}
				}
				return true;
			},
			configurable: true,
			writable: true,
		});
	});

	afterEach(() => {
		document.body.innerHTML = "";
	});

	it("includes scrollable ancestor elements and window", () => {
		const outer = document.createElement("div");
		outer.style.overflowX = "auto";
		Object.defineProperty(outer, "scrollWidth", { value: 800, configurable: true });
		Object.defineProperty(outer, "clientWidth", { value: 400, configurable: true });

		const inner = document.createElement("div");
		const target = document.createElement("div");

		inner.appendChild(target);
		outer.appendChild(inner);
		document.body.appendChild(outer);

		const targets = getScrollEventTargets(target);

		expect(targets).toContain(outer);
		expect(targets).toContain(window);
	});

	it("re-runs sync callback when a scroll parent scrolls", () => {
		const outer = document.createElement("div");
		outer.style.overflowY = "auto";
		Object.defineProperty(outer, "scrollHeight", { value: 800, configurable: true });
		Object.defineProperty(outer, "clientHeight", { value: 400, configurable: true });

		const target = document.createElement("div");
		outer.appendChild(target);
		document.body.appendChild(outer);

		const onScroll = vi.fn();
		const cleanup = observeScrollParents(target, onScroll);

		outer.dispatchEvent(new Event("scroll"));
		window.dispatchEvent(new Event("scroll"));

		expect(onScroll).toHaveBeenCalledTimes(2);

		cleanup();
		outer.dispatchEvent(new Event("scroll"));

		expect(onScroll).toHaveBeenCalledTimes(2);
	});
});
