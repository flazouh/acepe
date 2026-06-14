import { beforeEach, describe, expect, it, vi } from "vitest";
import type { PanelStore } from "../../../../store/panel-store.svelte.js";
import type { SessionStore } from "../../../../store/session-store.svelte.js";

const listenMock = vi.fn();
let zoomLevel = 0.8;

vi.mock("@tauri-apps/api/core", () => ({
	invoke: vi.fn(async () => undefined),
}));
vi.mock("@tauri-apps/api/event", () => ({
	listen: (...args: Parameters<typeof listenMock>) => listenMock(...args),
}));
vi.mock("$lib/services/zoom.svelte.js", () => ({
	getZoomService: () => ({
		zoomLevel,
	}),
}));

import { AgentInputState } from "../agent-input-state.svelte.js";

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

async function flushAsync(times = 10): Promise<void> {
	for (let index = 0; index < times; index += 1) {
		await Promise.resolve();
	}
}

describe("AgentInputState drag-drop hover bounds", () => {
	beforeEach(() => {
		listenMock.mockReset();
		zoomLevel = 0.8;
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

		const registeredDragOverHandler = requireDragOverHandler(dragOverHandler);
		registeredDragOverHandler({
			payload: {
				paths: ["/tmp/image.png"],
				position: { x: 201, y: 120 },
			},
		});

		expect(state.isDragHovering).toBe(false);
	});
});
