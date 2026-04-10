import { okAsync } from "neverthrow";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SessionDomainEvent } from "$lib/services/acp-types.js";
import type { AcpEventEnvelope } from "../acp-event-bridge.js";
import { SessionDomainEventSubscriber } from "../session-domain-event-subscriber.js";

const mockOpenAcpEventSource = vi.fn();

vi.mock("../acp-event-bridge.js", () => ({
	openAcpEventSource: (handler: (envelope: AcpEventEnvelope) => void) =>
		mockOpenAcpEventSource(handler),
}));

describe("SessionDomainEventSubscriber", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mockOpenAcpEventSource.mockReturnValue(okAsync(() => {}));
	});

	function createDomainEvent(): SessionDomainEvent {
		return {
			event_id: "evt-1",
			seq: 42,
			session_id: "session-1",
			provider_session_id: "provider-1",
			occurred_at_ms: 1234,
			causation_id: "cause-1",
			kind: "turn_started",
		};
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

	function requireEnvelopeEmitter(
		onEnvelope: ((envelope: AcpEventEnvelope) => void) | null
	): (envelope: AcpEventEnvelope) => void {
		if (!onEnvelope) {
			throw new Error("Expected ACP event bridge handler");
		}
		return onEnvelope;
	}

	it("emits typed domain events and ignores other ACP events", async () => {
		let onEnvelope: ((envelope: AcpEventEnvelope) => void) | null = null;
		mockOpenAcpEventSource.mockImplementationOnce(
			(handler: (envelope: AcpEventEnvelope) => void) => {
				onEnvelope = handler;
				return okAsync(() => {});
			}
		);

		const subscriber = new SessionDomainEventSubscriber();
		const listener = vi.fn();

		const result = await subscriber.subscribe(listener);
		expect(result.isOk()).toBe(true);
		expect(onEnvelope).not.toBeNull();

		const domainEvent = createDomainEvent();
		const emitEnvelope = requireEnvelopeEmitter(onEnvelope);
		emit(emitEnvelope, "acp-session-domain-event", domainEvent);
		emit(emitEnvelope, "acp-session-update", { type: "noop" });

		expect(listener).toHaveBeenCalledTimes(1);
		expect(listener).toHaveBeenCalledWith(domainEvent);
	});

	it("drops invalid domain event payloads", async () => {
		let onEnvelope: ((envelope: AcpEventEnvelope) => void) | null = null;
		mockOpenAcpEventSource.mockImplementationOnce(
			(handler: (envelope: AcpEventEnvelope) => void) => {
				onEnvelope = handler;
				return okAsync(() => {});
			}
		);

		const subscriber = new SessionDomainEventSubscriber();
		const listener = vi.fn();
		await subscriber.subscribe(listener);
		expect(onEnvelope).not.toBeNull();

		emit(requireEnvelopeEmitter(onEnvelope), "acp-session-domain-event", {
			event_id: "evt-1",
			seq: 42,
			session_id: "session-1",
			provider_session_id: null,
			occurred_at_ms: 1234,
			causation_id: null,
			kind: "not-a-real-kind",
		});

		expect(listener).not.toHaveBeenCalled();
	});

	it("cleans up the bridge listener when the last subscriber unsubscribes", async () => {
		const unlisten = vi.fn();
		mockOpenAcpEventSource.mockReturnValueOnce(okAsync(unlisten));
		const subscriber = new SessionDomainEventSubscriber();

		const first = await subscriber.subscribe(vi.fn());
		const second = await subscriber.subscribe(vi.fn());
		if (first.isErr() || second.isErr()) {
			throw new Error("Expected subscriptions to succeed");
		}

		subscriber.unsubscribeById(first.value);
		expect(unlisten).not.toHaveBeenCalled();

		subscriber.unsubscribeById(second.value);
		expect(unlisten).toHaveBeenCalledTimes(1);
	});
});
