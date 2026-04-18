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

	// ==========================================================================
	// Unit 0: Characterization — interaction recovery through reconnect
	// ==========================================================================

	it("[characterize] interaction events continue to fire after stop + restart (reconnect scenario)", async () => {
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
		// Simulate a mid-session interaction
		listener?.(createEvent("interaction_upserted"));
		expect(hydrateSessionMock).toHaveBeenCalledTimes(1);

		// Reconnect: stop and re-start (e.g. after a provider disconnect)
		sync.stop();
		hydrateSessionMock.mockClear();

		// Re-start the sync (as the reconnect path does)
		await sync.start();

		// Subsequent interaction events must still fire after the reconnect
		// (listener is re-bound by subscribeMock when start() is called again)
		if (listener !== null) {
			listener(createEvent("interaction_upserted"));
			listener(createEvent("interaction_resolved"));
		}
		expect(hydrateSessionMock).toHaveBeenCalledTimes(2);
	});

	it("[characterize] permission and question interaction events each trigger hydration independently", async () => {
		// Permissions and questions arrive as `interaction_upserted` events.
		// Each must trigger exactly one hydration call so the UI stays in sync.
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

		listener?.(createEvent("interaction_upserted")); // permission arrived
		listener?.(createEvent("interaction_upserted")); // question arrived
		listener?.(createEvent("interaction_cancelled")); // user cancelled one

		expect(hydrateSessionMock).toHaveBeenCalledTimes(3);
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
});
