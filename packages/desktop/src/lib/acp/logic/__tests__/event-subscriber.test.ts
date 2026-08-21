import { fromPromise } from "@acepe/effect-result/fromPromise";
import * as Effect from "effect/Effect";
import * as Result from "effect/Result";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ProtocolError } from "../../errors/index.js";
import type { AcpEventEnvelope } from "../acp-event-bridge.js";
import { EventSubscriber } from "../event-subscriber.js";
import { createTestAcpEventDrain } from "./fixtures/acp-event-drain-stub.js";

const mockOpenAcpEventSource = vi.fn();

vi.mock("../acp-event-bridge.js", () => ({
	createAcpEventDrain: createTestAcpEventDrain,
	openAcpEventSource: (...args: Parameters<typeof mockOpenAcpEventSource>) =>
		mockOpenAcpEventSource(...args),
}));

describe("EventSubscriber", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mockOpenAcpEventSource.mockReturnValue(Effect.succeed(() => {}));
	});

	function createDeferred<T>() {
		let resolve!: (value: T) => void;
		let reject!: (error: unknown) => void;
		const promise = new Promise<T>((res, rej) => {
			resolve = res;
			reject = rej;
		});
		return { promise, resolve, reject };
	}

	function emit(
		onEnvelope: (envelope: AcpEventEnvelope) => void,
		eventName: string,
		payload: AcpEventEnvelope["payload"]
	): void {
		onEnvelope({
			seq: 1,
			eventName,
			sessionId: "session-1",
			payload,
			priority: "normal",
			droppable: false,
			emittedAtMs: 1234,
		});
	}

	describe("subscription management", () => {
		it("allows multiple listeners to subscribe", async () => {
			const subscriber = new EventSubscriber();
			const listener1 = vi.fn();
			const listener2 = vi.fn();

			const result1 = await Effect.runPromise(Effect.result(subscriber.subscribe(listener1)));
			const result2 = await Effect.runPromise(Effect.result(subscriber.subscribe(listener2)));

			expect(Result.isSuccess(result1)).toBe(true);
			expect(Result.isSuccess(result2)).toBe(true);
			expect(Result.getOrThrow(result1)).not.toBe(Result.getOrThrow(result2));
			expect(subscriber.listenerCount).toBe(2);
		});

		it("allows unsubscribing by ID", async () => {
			const subscriber = new EventSubscriber();
			const listener = vi.fn();

			const result = await Effect.runPromise(Effect.result(subscriber.subscribe(listener)));
			expect(Result.isSuccess(result)).toBe(true);
			expect(subscriber.listenerCount).toBe(1);

			subscriber.unsubscribeById(Result.getOrThrow(result));
			expect(subscriber.listenerCount).toBe(0);
		});

		it("provides unique listener IDs", async () => {
			const subscriber = new EventSubscriber();
			const listener = vi.fn();

			const result1 = await Effect.runPromise(Effect.result(subscriber.subscribe(listener)));
			subscriber.unsubscribeById(Result.getOrThrow(result1));

			const result2 = await Effect.runPromise(Effect.result(subscriber.subscribe(listener)));

			expect(Result.getOrThrow(result1)).not.toBe(Result.getOrThrow(result2));
		});

		it("cleans up native listener when unsubscribed before init resolves", async () => {
			const deferred = createDeferred<() => void>();
			const unlisten = vi.fn();
			mockOpenAcpEventSource.mockReturnValueOnce(
				fromPromise(
					() => deferred.promise,
					(error) => new ProtocolError(`Failed to open ACP event source: ${error}`, error)
				)
			);

			const subscriber = new EventSubscriber();
			const firstSubscribe = subscriber.subscribe(vi.fn());

			// Listener IDs are deterministic: listener-1, listener-2, ...
			subscriber.unsubscribeById("listener-1");

			deferred.resolve(unlisten);
			const result = await Effect.runPromise(Effect.result(firstSubscribe));

			expect(Result.isSuccess(result)).toBe(true);
			expect(unlisten).toHaveBeenCalledTimes(1);
			expect(subscriber.listenerCount).toBe(0);

			await subscriber.subscribe(vi.fn());
			expect(mockOpenAcpEventSource).toHaveBeenCalledTimes(2);
		});

		it("propagates init failure to waiting subscribers", async () => {
			const deferred = createDeferred<() => void>();
			mockOpenAcpEventSource.mockReturnValueOnce(
				fromPromise(
					() => deferred.promise,
					(error) => new ProtocolError(`Failed to open ACP event source: ${error}`, error)
				)
			);

			const subscriber = new EventSubscriber();
			const firstSubscribe = subscriber.subscribe(vi.fn());
			const secondSubscribe = subscriber.subscribe(vi.fn());

			deferred.reject(new Error("listen failed"));

			const first = await Effect.runPromise(Effect.result(firstSubscribe));
			const second = await Effect.runPromise(Effect.result(secondSubscribe));

			expect(Result.isFailure(first)).toBe(true);
			expect(Result.isFailure(second)).toBe(true);
			expect(subscriber.listenerCount).toBe(0);
		});

		it("routes acp-session-state envelopes to session-state listeners only", async () => {
			let onEnvelope: ((envelope: AcpEventEnvelope) => void) | null = null;
			mockOpenAcpEventSource.mockImplementationOnce(
				(handler: (envelope: AcpEventEnvelope) => void) => {
					onEnvelope = handler;
					return Effect.succeed(() => {});
				}
			);

			const subscriber = new EventSubscriber();
			const sessionUpdateListener = vi.fn();
			const sessionStateListener = vi.fn();

			await Effect.runPromise(subscriber.subscribe(sessionUpdateListener));
			await Effect.runPromise(subscriber.subscribeSessionState(sessionStateListener));

			if (!onEnvelope) {
				throw new Error("Expected ACP event bridge handler");
			}

			emit(onEnvelope, "acp-session-state", {
				sessionId: "session-1",
				graphRevision: 4,
				lastEventSeq: 9,
				payload: {
					kind: "delta",
					delta: {
						fromRevision: { graphRevision: 3, transcriptRevision: 3, lastEventSeq: 8 },
						toRevision: { graphRevision: 4, transcriptRevision: 4, lastEventSeq: 9 },
						activity: {
							kind: "idle",
							activeOperationCount: 0,
							activeSubagentCount: 0,
							dominantOperationId: null,
							blockingInteractionId: null,
						},
						turnState: "Running",
						activeTurnFailure: null,
						lastTerminalTurnId: null,
						transcriptOperations: [],
						operationPatches: [],
						interactionPatches: [],
						changedFields: ["transcriptSnapshot"],
					},
				},
			});

			expect(sessionUpdateListener).not.toHaveBeenCalled();
			expect(sessionStateListener).toHaveBeenCalledTimes(1);
			expect(sessionStateListener).toHaveBeenCalledWith(
				expect.objectContaining({
					sessionId: "session-1",
					graphRevision: 4,
					lastEventSeq: 9,
				})
			);
		});
	});
});
