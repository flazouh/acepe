import { describe, expect, it } from "vitest";

import type { SessionProjectionSnapshot } from "$lib/services/acp-types.js";

import { SessionStore } from "../session-store.svelte.js";

function createProjectionSnapshot(
	overrides: Partial<SessionProjectionSnapshot["session"]> = {}
): SessionProjectionSnapshot {
	return {
		session: {
			session_id: "session-1",
			agent_id: "codex",
			last_event_seq: 7,
			turn_state: "Failed",
			message_count: 1,
			last_agent_message_id: null,
			active_tool_call_ids: [],
			completed_tool_call_ids: [],
			active_turn_failure: {
				turn_id: "turn-1",
				message: "Usage limit reached",
				code: "429",
				kind: "recoverable",
				source: "process",
			},
			last_terminal_turn_id: "turn-1",
			...overrides,
		} as SessionProjectionSnapshot["session"],
		operations: [],
		interactions: [],
	};
}

describe("SessionStore.applySessionProjection", () => {
	it("hydrates canonical failed-turn state from the session projection", () => {
		const store = new SessionStore();

		store.applySessionProjection(createProjectionSnapshot());

		expect(store.getHotState("session-1")).toMatchObject({
			turnState: "error",
			connectionError: null,
			activeTurnFailure: {
				turnId: "turn-1",
				message: "Usage limit reached",
				code: "429",
				kind: "recoverable",
				source: "process",
			},
			lastTerminalTurnId: "turn-1",
		});
	});

	it("clears hydrated failed-turn state when the projection no longer has one", () => {
		const store = new SessionStore();

		store.applySessionProjection(createProjectionSnapshot());
		store.applySessionProjection(
			createProjectionSnapshot({
				turn_state: "Completed",
				active_turn_failure: null,
				last_terminal_turn_id: "turn-1",
			})
		);

		expect(store.getHotState("session-1")).toMatchObject({
			turnState: "completed",
			activeTurnFailure: null,
			lastTerminalTurnId: "turn-1",
		});
	});

	it("defaults missing projected failure source to unknown during hydration", () => {
		const store = new SessionStore();
		const snapshot = createProjectionSnapshot();
		if (snapshot.session && snapshot.session.active_turn_failure) {
			Reflect.deleteProperty(snapshot.session.active_turn_failure, "source");
		}

		store.applySessionProjection(snapshot);

		expect(store.getHotState("session-1")).toMatchObject({
			activeTurnFailure: {
				source: "unknown",
			},
		});
	});
});
