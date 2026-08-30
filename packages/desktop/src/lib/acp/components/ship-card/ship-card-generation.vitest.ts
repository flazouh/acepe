import { EventId, MessageId, type OrchestrationEvent, SessionId } from "@acepe/contracts";
import * as Effect from "effect/Effect";
import * as Result from "effect/Result";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { SessionStateEnvelope } from "$lib/services/acp-types.js";
import type { AcpEventEnvelope } from "$lib/acp/logic/acp-event-bridge.js";
import { OrchestrationCanonicalBridge } from "$lib/acp/logic/orchestration-canonical-bridge.js";

const mockCloseSession = vi.fn();
const mockNewSession = vi.fn();
const mockSendPrompt = vi.fn();
const mockSetModel = vi.fn();
const mockSubscribeSessionState = vi.fn();
const mockUnsubscribeById = vi.fn();

let sessionStateListener: ((envelope: SessionStateEnvelope) => void) | null = null;

vi.mock("$lib/acp/utils/logger.js", () => ({
	createLogger: () => ({
		debug: vi.fn(),
		error: vi.fn(),
		info: vi.fn(),
		warn: vi.fn(),
		isLevelEnabled: () => false,
	}),
}));

vi.mock("$lib/acp/logic/event-subscriber.js", () => ({
	EventSubscriber: class {
		subscribeSessionState(handler: (envelope: SessionStateEnvelope) => void) {
			sessionStateListener = handler;
			return mockSubscribeSessionState(handler);
		}

		unsubscribeById(listenerId: string): void {
			mockUnsubscribeById(listenerId);
		}
	},
}));

vi.mock("$lib/utils/backend-client.js", () => ({
	openFileInEditor: vi.fn(),
	revealInFinder: vi.fn(),
	backendClient: {
		acp: {
			closeSession: (...args: Parameters<typeof mockCloseSession>) => mockCloseSession(...args),
			newSession: (...args: Parameters<typeof mockNewSession>) => mockNewSession(...args),
			sendPrompt: (...args: Parameters<typeof mockSendPrompt>) => mockSendPrompt(...args),
			setModel: (...args: Parameters<typeof mockSetModel>) => mockSetModel(...args),
		},
	},
}));

import { generateShipContentStreaming } from "./ship-card-generation.js";

const EPHEMERAL_SESSION_ID = "session-ship-card-1";
const shipSessionId = SessionId.make(EPHEMERAL_SESSION_ID);
const shipMessageId = MessageId.make("message-ship-card-1");

let orchestrationSeq = 0;

function orchestrationEvent<Payload>(type: string, payload: Payload): OrchestrationEvent {
	orchestrationSeq += 1;
	return {
		sequence: orchestrationSeq,
		eventId: EventId.make(`event-${String(orchestrationSeq)}`),
		aggregateKind: "session",
		aggregateId: shipSessionId,
		occurredAt: "2026-08-30T12:00:00.000Z",
		commandId: "cmd-ship-card",
		causationEventId: null,
		correlationId: "cmd-ship-card",
		metadata: {},
		type,
		payload,
	} as unknown as OrchestrationEvent;
}

/**
 * Drives the real producer.
 *
 * The bridge in `orchestration-canonical-bridge.ts` is the ONLY thing that
 * builds envelopes for the page's event stream, so pushing its actual output at
 * the ship card proves the card reads the lane the app really runs on.
 */
function deliverOrchestrationEvent(
	bridge: OrchestrationCanonicalBridge,
	event: OrchestrationEvent
): void {
	const envelopes: ReadonlyArray<AcpEventEnvelope> = Effect.runSync(bridge.translate(event));
	for (const envelope of envelopes) {
		sessionStateListener?.(envelope.payload as unknown as SessionStateEnvelope);
	}
}

describe("generateShipContentStreaming", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		sessionStateListener = null;
		orchestrationSeq = 0;
		mockCloseSession.mockReturnValue(Effect.succeed(undefined));
		mockNewSession.mockReturnValue(Effect.succeed({ sessionId: EPHEMERAL_SESSION_ID }));
		mockSendPrompt.mockReturnValue(Effect.succeed(undefined));
		mockSetModel.mockReturnValue(Effect.succeed(undefined));
		mockSubscribeSessionState.mockReturnValue(Effect.succeed("listener-1"));
	});

	afterEach(() => {
		vi.useRealTimers();
	});

	it("closes the hidden session if model setup fails", async () => {
		mockSetModel.mockReturnValue(Effect.fail(new Error("unsupported model")));

		const result = await Effect.runPromise(
			Effect.result(
				generateShipContentStreaming("prompt", "/repo", vi.fn(), "agent-id", "bad-model")
			)
		);

		expect(Result.isFailure(result)).toBe(true);
		expect(mockCloseSession).toHaveBeenCalledWith(EPHEMERAL_SESSION_ID);
		expect(mockSubscribeSessionState).not.toHaveBeenCalled();
		expect(mockSendPrompt).not.toHaveBeenCalled();
	});

	it("fills and resolves from the canonical session-state lane, without the timeout", async () => {
		vi.useFakeTimers();
		const bridge = new OrchestrationCanonicalBridge(() => Effect.succeed("/repo"));
		const onUpdate = vi.fn();

		const generation = Effect.runPromise(
			Effect.result(generateShipContentStreaming("prompt", "/repo", onUpdate, "claude-code"))
		);

		await vi.waitFor(() => {
			expect(mockSendPrompt).toHaveBeenCalledTimes(1);
		});

		deliverOrchestrationEvent(
			bridge,
			orchestrationEvent("MessageSent", {
				sessionId: shipSessionId,
				messageId: shipMessageId,
				text: "prompt",
			})
		);
		for (const token of [
			"<ship><commit-message>fix the lane",
			"</commit-message><pr-title>Fix the lane</pr-title>",
			"<pr-description>Body.</pr-description></ship>",
		]) {
			deliverOrchestrationEvent(
				bridge,
				orchestrationEvent("TokenAppended", {
					sessionId: shipSessionId,
					messageId: shipMessageId,
					token,
				})
			);
		}
		deliverOrchestrationEvent(
			bridge,
			orchestrationEvent("TurnCompleted", { sessionId: shipSessionId })
		);

		const result = await generation;

		if (Result.isFailure(result)) {
			throw new Error(`expected success, got ${result.failure.message}`);
		}
		expect(result.success.commitMessage).toBe("fix the lane");
		expect(result.success.prTitle).toBe("Fix the lane");
		expect(result.success.prDescription).toBe("Body.");
		expect(result.success.complete).toBe(true);
		// The card filled while the reply streamed, not only at the end.
		expect(onUpdate.mock.calls.length).toBeGreaterThan(1);
		// Nothing is left waiting: the 60s generation timeout was cleared.
		expect(vi.getTimerCount()).toBe(0);
		expect(mockUnsubscribeById).toHaveBeenCalledWith("listener-1");
		expect(mockCloseSession).toHaveBeenCalledWith(EPHEMERAL_SESSION_ID);
	});

	it("fails the generation when the canonical lane reports a failed turn", async () => {
		const bridge = new OrchestrationCanonicalBridge(() => Effect.succeed("/repo"));

		const generation = Effect.runPromise(
			Effect.result(generateShipContentStreaming("prompt", "/repo", vi.fn(), "claude-code"))
		);

		await vi.waitFor(() => {
			expect(mockSendPrompt).toHaveBeenCalledTimes(1);
		});

		deliverOrchestrationEvent(
			bridge,
			orchestrationEvent("MessageSent", {
				sessionId: shipSessionId,
				messageId: shipMessageId,
				text: "prompt",
			})
		);
		deliverOrchestrationEvent(
			bridge,
			orchestrationEvent("ProviderSessionFailed", {
				sessionId: shipSessionId,
				providerId: "claude-code",
				operation: "sendPrompt",
				detail: "adapter stream died",
			})
		);

		const result = await generation;

		expect(Result.isFailure(result)).toBe(true);
		if (Result.isFailure(result)) {
			expect(result.failure.operation).toBe("stream");
			expect(result.failure.cause).toBeInstanceOf(Error);
			expect((result.failure.cause as Error).message).toContain("adapter stream died");
		}
		expect(mockCloseSession).toHaveBeenCalledWith(EPHEMERAL_SESSION_ID);
	});
});
