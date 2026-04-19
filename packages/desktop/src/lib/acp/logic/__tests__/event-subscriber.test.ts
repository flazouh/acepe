import { okAsync, ResultAsync } from "neverthrow";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ProtocolError } from "../../errors/index.js";
import type { AcpEventEnvelope } from "../acp-event-bridge.js";
import { EventSubscriber } from "../event-subscriber.js";

const mockOpenAcpEventSource = vi.fn();

vi.mock("../acp-event-bridge.js", () => ({
	openAcpEventSource: (...args: Parameters<typeof mockOpenAcpEventSource>) =>
		mockOpenAcpEventSource(...args),
}));

describe("EventSubscriber", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mockOpenAcpEventSource.mockReturnValue(okAsync(() => {}));
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

			const result1 = await subscriber.subscribe(listener1);
			const result2 = await subscriber.subscribe(listener2);

			expect(result1.isOk()).toBe(true);
			expect(result2.isOk()).toBe(true);
			expect(result1._unsafeUnwrap()).not.toBe(result2._unsafeUnwrap());
			expect(subscriber.listenerCount).toBe(2);
		});

		it("allows unsubscribing by ID", async () => {
			const subscriber = new EventSubscriber();
			const listener = vi.fn();

			const result = await subscriber.subscribe(listener);
			expect(result.isOk()).toBe(true);
			expect(subscriber.listenerCount).toBe(1);

			subscriber.unsubscribeById(result._unsafeUnwrap());
			expect(subscriber.listenerCount).toBe(0);
		});

		it("provides unique listener IDs", async () => {
			const subscriber = new EventSubscriber();
			const listener = vi.fn();

			const result1 = await subscriber.subscribe(listener);
			subscriber.unsubscribeById(result1._unsafeUnwrap());

			const result2 = await subscriber.subscribe(listener);

			expect(result1._unsafeUnwrap()).not.toBe(result2._unsafeUnwrap());
		});

		it("cleans up native listener when unsubscribed before init resolves", async () => {
			const deferred = createDeferred<() => void>();
			const unlisten = vi.fn();
			mockOpenAcpEventSource.mockReturnValueOnce(
				ResultAsync.fromPromise(
					deferred.promise,
					(error) => new ProtocolError(`Failed to open ACP event source: ${error}`, error)
				)
			);

			const subscriber = new EventSubscriber();
			const firstSubscribe = subscriber.subscribe(vi.fn());

			// Listener IDs are deterministic: listener-1, listener-2, ...
			subscriber.unsubscribeById("listener-1");

			deferred.resolve(unlisten);
			const result = await firstSubscribe;

			expect(result.isOk()).toBe(true);
			expect(unlisten).toHaveBeenCalledTimes(1);
			expect(subscriber.listenerCount).toBe(0);

			await subscriber.subscribe(vi.fn());
			expect(mockOpenAcpEventSource).toHaveBeenCalledTimes(2);
		});

		it("propagates init failure to waiting subscribers", async () => {
			const deferred = createDeferred<() => void>();
			mockOpenAcpEventSource.mockReturnValueOnce(
				ResultAsync.fromPromise(
					deferred.promise,
					(error) => new ProtocolError(`Failed to open ACP event source: ${error}`, error)
				)
			);

			const subscriber = new EventSubscriber();
			const firstSubscribe = subscriber.subscribe(vi.fn());
			const secondSubscribe = subscriber.subscribe(vi.fn());

			deferred.reject(new Error("listen failed"));

			const first = await firstSubscribe;
			const second = await secondSubscribe;

			expect(first.isErr()).toBe(true);
			expect(second.isErr()).toBe(true);
			expect(subscriber.listenerCount).toBe(0);
		});

		it("routes acp-session-state envelopes to session-state listeners only", async () => {
			let onEnvelope: ((envelope: AcpEventEnvelope) => void) | null = null;
			mockOpenAcpEventSource.mockImplementationOnce(
				(handler: (envelope: AcpEventEnvelope) => void) => {
					onEnvelope = handler;
					return okAsync(() => {});
				}
			);

			const subscriber = new EventSubscriber();
			const sessionUpdateListener = vi.fn();
			const sessionStateListener = vi.fn();

			await subscriber.subscribe(sessionUpdateListener);
			await subscriber.subscribeSessionState(sessionStateListener);

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
						fromRevision: { graphRevision: 3, lastEventSeq: 8 },
						toRevision: { graphRevision: 4, lastEventSeq: 9 },
						transcriptDelta: {
							eventSeq: 9,
							sessionId: "session-1",
							snapshotRevision: 4,
							operations: [],
						},
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

	describe("deprecated unsubscribe method", () => {
		it("removes all listeners", async () => {
			const subscriber = new EventSubscriber();
			const listener1 = vi.fn();
			const listener2 = vi.fn();

			await subscriber.subscribe(listener1);
			await subscriber.subscribe(listener2);
			expect(subscriber.listenerCount).toBe(2);

			subscriber.unsubscribe();
			expect(subscriber.listenerCount).toBe(0);
		});
	});
});
