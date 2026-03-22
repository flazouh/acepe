import { beforeEach, describe, expect, it } from "bun:test";

import { createEventListener, type EventListener } from "../event-listener.js";

// Extended mock type for testing
interface MockTauriListen {
	(eventName: string, callback: (event: { payload: unknown }) => void): Promise<() => void>;
	lastCallback?: (event: { payload: unknown }) => void;
	unlistened?: boolean;
}

describe("Event Listener", () => {
	let mockTauriListen: MockTauriListen;
	let listener: EventListener;

	beforeEach(() => {
		const fn: MockTauriListen = async (
			_eventName: string,
			callback: (event: { payload: unknown }) => void
		) => {
			// Store the callback for testing
			fn.lastCallback = callback;
			// Return an unlisten function
			return () => {
				fn.unlistened = true;
			};
		};
		mockTauriListen = fn;

		const mockLogger = {
			info: () => {},
			debug: () => {},
			warn: () => {},
			error: () => {},
		};

		listener = createEventListener({
			tauriListen: mockTauriListen,
			logger: mockLogger,
		});
	});

	it("should initialize with no active listener", () => {
		expect(listener).toBeDefined();
	});

	it("should subscribe to Tauri events", async () => {
		const mockUpdateHandler = (_update: unknown) => {
			// This will be called when updates arrive
		};

		const result = await listener.subscribe(mockUpdateHandler);

		expect(result.isOk()).toBe(true);
	});

	it("should store the unlisten function on successful subscribe", async () => {
		const result = await listener.subscribe(() => {});

		expect(result.isOk()).toBe(true);
		// The listener should have stored the unlisten function
		expect(listener.hasUnlistenFn()).toBe(true);
	});

	it("should handle subscription failure", async () => {
		mockTauriListen = async () => {
			throw new Error("Tauri listen failed");
		};

		const newListener = createEventListener({
			tauriListen: mockTauriListen,
			logger: {
				info: () => {},
				debug: () => {},
				warn: () => {},
				error: () => {},
			},
		});

		const result = await newListener.subscribe(() => {});

		expect(result.isErr()).toBe(true);
	});

	it("should unsubscribe from events", async () => {
		await listener.subscribe(() => {});
		listener.unsubscribe();

		expect(mockTauriListen.unlistened).toBe(true);
	});

	it("should handle unsubscribe when never subscribed", () => {
		// Should not throw
		expect(() => {
			listener.unsubscribe();
		}).not.toThrow();
	});

	it("should call the update handler when events arrive", async () => {
		let handlerCalled = false;
		const mockUpdate = { type: "test", data: "test data" };

		const updateHandler = () => {
			handlerCalled = true;
		};

		await listener.subscribe(updateHandler);

		// Simulate an event arriving from Tauri
		const callback = mockTauriListen.lastCallback;
		if (callback) {
			callback({ payload: mockUpdate });
		}

		expect(handlerCalled).toBe(true);
	});

	it("should pass the payload to the update handler", async () => {
		let receivedPayload: unknown;

		const updateHandler = (payload: unknown) => {
			receivedPayload = payload;
		};

		await listener.subscribe(updateHandler);

		const mockUpdate = { type: "agentMessageChunk", content: "Hello" };
		const callback = mockTauriListen.lastCallback;
		if (callback) {
			callback({ payload: mockUpdate });
		}

		expect(receivedPayload).toEqual(mockUpdate);
	});

	it("should listen for acp-session-update events", async () => {
		let listenEventName = "";

		const mockListenWithEventCapture = async (
			eventName: string,
			callback: (event: { payload: unknown }) => void
		) => {
			listenEventName = eventName;
			mockTauriListen.lastCallback = callback;
			return () => {};
		};

		const newListener = createEventListener({
			tauriListen: mockListenWithEventCapture,
			logger: {
				info: () => {},
				debug: () => {},
				warn: () => {},
				error: () => {},
			},
		});

		await newListener.subscribe(() => {});

		expect(listenEventName).toBe("acp-session-update");
	});

	it("should allow re-subscription after unsubscribe", async () => {
		await listener.subscribe(() => {});
		listener.unsubscribe();

		expect(listener.hasUnlistenFn()).toBe(false);

		const result = await listener.subscribe(() => {});
		expect(result.isOk()).toBe(true);
	});
});
