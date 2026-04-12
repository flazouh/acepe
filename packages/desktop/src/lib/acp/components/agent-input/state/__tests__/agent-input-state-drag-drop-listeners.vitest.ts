import { mock } from "bun:test";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { PanelStore } from "../../../../store/panel-store.svelte.js";
import type { SessionStore } from "../../../../store/session-store.svelte.js";

const listenMock = vi.fn();
const invokeMock = vi.fn();
let zoomLevel = 0.8;

let AgentInputState: typeof import("../agent-input-state.svelte.js").AgentInputState;

interface DragPositionEvent {
	payload: {
		paths: string[];
		position: {
			x: number;
			y: number;
		};
	};
}

function requireDragOverHandler(
	handler: ((event: DragPositionEvent) => void) | null
): (event: DragPositionEvent) => void {
	if (handler === null) {
		throw new Error("Expected tauri://drag-over listener to register");
	}

	return handler;
}

function createPendingPromise<T>() {
	let resolveValue: ((value: T) => void) | null = null;
	const promise = new Promise<T>((resolve) => {
		resolveValue = resolve;
	});

	return {
		promise,
		resolve(value: T) {
			if (resolveValue) {
				resolveValue(value);
			}
		},
	};
}

async function flushAsync(times = 10): Promise<void> {
	for (let index = 0; index < times; index += 1) {
		await Promise.resolve();
	}
}

describe("AgentInputState drag-drop listener lifecycle", () => {
	beforeEach(async () => {
		listenMock.mockReset();
		invokeMock.mockReset();
		zoomLevel = 0.8;

		mock.module("@tauri-apps/api/core", () => ({
			invoke: invokeMock,
		}));
		mock.module("@tauri-apps/api/event", () => ({
			listen: listenMock,
		}));
		mock.module("$lib/services/zoom.svelte.js", () => ({
			getZoomService: () => ({
				zoomLevel,
			}),
		}));

		({ AgentInputState } = await import("../agent-input-state.svelte.js"));
	});

	it("cleans up listeners that finish registering after destroy", async () => {
		const hoverRegistration = createPendingPromise<() => void>();
		const dropRegistration = createPendingPromise<() => void>();
		const leaveRegistration = createPendingPromise<() => void>();
		const unlistenHover = vi.fn();
		const unlistenDrop = vi.fn();
		const unlistenLeave = vi.fn();

		listenMock
			.mockReturnValueOnce(hoverRegistration.promise)
			.mockReturnValueOnce(dropRegistration.promise)
			.mockReturnValueOnce(leaveRegistration.promise);

		const state = new AgentInputState({} as SessionStore, {} as PanelStore);
		state.initialize();

		hoverRegistration.resolve(unlistenHover);
		await flushAsync();

		state.destroy();
		await flushAsync();

		expect(unlistenHover).toHaveBeenCalledTimes(1);

		dropRegistration.resolve(unlistenDrop);
		await flushAsync();

		leaveRegistration.resolve(unlistenLeave);
		await flushAsync();

		expect(unlistenDrop).toHaveBeenCalledTimes(1);
		expect(unlistenLeave).toHaveBeenCalledTimes(1);
	});

	it("does not highlight the composer for native drag positions outside its zoomed bounds", async () => {
		let dragOverHandler: ((event: DragPositionEvent) => void) | null = null;

		listenMock.mockImplementation(
			(eventName: string, handler: ((event: DragPositionEvent) => void) | (() => void)) => {
				if (eventName === "tauri://drag-over") {
					dragOverHandler = handler as (event: DragPositionEvent) => void;
				}

				return Promise.resolve(() => {});
			}
		);

		const state = new AgentInputState({} as SessionStore, {} as PanelStore);
		state.containerRef = {
			getBoundingClientRect: () => ({
				x: 100,
				y: 100,
				width: 100,
				height: 100,
				top: 100,
				right: 200,
				bottom: 200,
				left: 100,
				toJSON: () => ({}),
			}),
		} as HTMLElement;

		state.initialize();
		await flushAsync();

		expect(dragOverHandler).not.toBeNull();
		const registeredDragOverHandler = requireDragOverHandler(dragOverHandler);

		registeredDragOverHandler({
			payload: {
				paths: ["/tmp/image.png"],
				position: { x: 170, y: 120 },
			},
		});

		expect(state.isDragActive).toBe(true);
		expect(state.isDragHovering).toBe(false);
	});

	it("does not highlight the composer for native drag positions just outside its bounds", async () => {
		let dragOverHandler: ((event: DragPositionEvent) => void) | null = null;
		zoomLevel = 1;

		listenMock.mockImplementation(
			(eventName: string, handler: ((event: DragPositionEvent) => void) | (() => void)) => {
				if (eventName === "tauri://drag-over") {
					dragOverHandler = handler as (event: DragPositionEvent) => void;
				}

				return Promise.resolve(() => {});
			}
		);

		const state = new AgentInputState({} as SessionStore, {} as PanelStore);
		state.containerRef = {
			getBoundingClientRect: () => ({
				x: 100,
				y: 100,
				width: 100,
				height: 100,
				top: 100,
				right: 200,
				bottom: 200,
				left: 100,
				toJSON: () => ({}),
			}),
		} as HTMLElement;

		state.initialize();
		await flushAsync();

		expect(dragOverHandler).not.toBeNull();
		const registeredDragOverHandler = requireDragOverHandler(dragOverHandler);

		registeredDragOverHandler({
			payload: {
				paths: ["/tmp/image.png"],
				position: { x: 201, y: 120 },
			},
		});

		expect(state.isDragHovering).toBe(false);
	});

	it("does not crash when Tauri already removed drag-drop listeners during destroy", async () => {
		listenMock.mockImplementation(() =>
			Promise.resolve(async () => {
				throw new TypeError("undefined is not an object (evaluating 'listeners[eventId].handlerId')");
			})
		);

		const state = new AgentInputState({} as SessionStore, {} as PanelStore);
		state.initialize();
		await flushAsync();

		expect(() => state.destroy()).not.toThrow();
		await flushAsync();
	});
});
