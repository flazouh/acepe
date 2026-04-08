import { beforeEach, describe, expect, it, mock } from "bun:test";
import { okAsync } from "neverthrow";
import type { SessionDomainEvent } from "../../../../services/acp-types.js";
import { LiveInteractionProjectionSync } from "../live-interaction-projection-sync.js";

describe("LiveInteractionProjectionSync", () => {
	let listener: ((event: SessionDomainEvent) => void) | null;
	const subscribeMock = mock((nextListener: (event: SessionDomainEvent) => void) => {
		listener = nextListener;
		return okAsync("listener-1");
	});
	const unsubscribeByIdMock = mock(() => {});
	const hydrateSessionMock = mock(() => okAsync(undefined));

	beforeEach(() => {
		listener = null;
		subscribeMock.mockClear();
		unsubscribeByIdMock.mockClear();
		hydrateSessionMock.mockClear();
	});

	it("hydrates the session projection for interaction lifecycle events", async () => {
		const sync = new LiveInteractionProjectionSync(
			{
				subscribe: subscribeMock,
				unsubscribeById: unsubscribeByIdMock,
			},
			{
				hydrateSession: hydrateSessionMock,
			}
		);

		const result = await sync.start();

		expect(result.isOk()).toBe(true);
		expect(listener).not.toBeNull();
		listener?.(createEvent("interaction_upserted"));
		listener?.(createEvent("interaction_resolved"));
		listener?.(createEvent("interaction_cancelled"));

		expect(hydrateSessionMock).toHaveBeenCalledTimes(3);
		expect(hydrateSessionMock).toHaveBeenCalledWith("session-1");
	});

	it("ignores non-interaction domain events", async () => {
		const sync = new LiveInteractionProjectionSync(
			{
				subscribe: subscribeMock,
				unsubscribeById: unsubscribeByIdMock,
			},
			{
				hydrateSession: hydrateSessionMock,
			}
		);

		await sync.start();
		listener?.(createEvent("turn_completed"));

		expect(hydrateSessionMock).not.toHaveBeenCalled();
	});

	it("unsubscribes when stopped", async () => {
		const sync = new LiveInteractionProjectionSync(
			{
				subscribe: subscribeMock,
				unsubscribeById: unsubscribeByIdMock,
			},
			{
				hydrateSession: hydrateSessionMock,
			}
		);

		await sync.start();
		sync.stop();

		expect(unsubscribeByIdMock).toHaveBeenCalledWith("listener-1");
	});
});

function createEvent(kind: SessionDomainEvent["kind"]): SessionDomainEvent {
	return {
		event_id: "event-1",
		seq: 1,
		session_id: "session-1",
		provider_session_id: null,
		occurred_at_ms: 1,
		causation_id: null,
		kind,
	};
}
