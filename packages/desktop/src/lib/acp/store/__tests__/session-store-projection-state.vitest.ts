import { describe, expect, it } from "vitest";

import type {
	SessionProjectionSnapshot,
	SessionSnapshot,
	TurnFailureSnapshot,
} from "$lib/services/acp-types.js";

import { SessionStore } from "../session-store.svelte.js";

type ProjectionFailureOverride =
	| Partial<TurnFailureSnapshot>
	| null;

type ProjectionSessionOverride = Omit<
	Partial<SessionSnapshot>,
	"active_turn_failure"
> & {
	active_turn_failure?: ProjectionFailureOverride;
};

function createProjectionSnapshot(
	overrides: ProjectionSessionOverride = {}
): SessionProjectionSnapshot {
	const activeTurnFailureOverride = overrides.active_turn_failure;
	const session: SessionSnapshot = {
		session_id: "session-1",
		agent_id: "codex",
		last_event_seq: 7,
		turn_state: "Failed",
		message_count: 1,
		last_agent_message_id: null,
		active_tool_call_ids: [],
		completed_tool_call_ids: [],
		active_turn_failure:
			activeTurnFailureOverride === undefined
				? {
						turn_id: "turn-1",
						message: "Usage limit reached",
						code: "429",
						kind: "recoverable",
						source: "process",
					}
				: activeTurnFailureOverride === null
					? null
					: {
							turn_id: activeTurnFailureOverride.turn_id ?? "turn-1",
							message: activeTurnFailureOverride.message ?? "Usage limit reached",
							code: activeTurnFailureOverride.code ?? "429",
							kind: activeTurnFailureOverride.kind ?? "recoverable",
							source: activeTurnFailureOverride.source ?? "unknown",
						},
		last_terminal_turn_id: "turn-1",
	};

	if (overrides.session_id !== undefined) {
		session.session_id = overrides.session_id;
	}
	if (overrides.agent_id !== undefined) {
		session.agent_id = overrides.agent_id;
	}
	if (overrides.last_event_seq !== undefined) {
		session.last_event_seq = overrides.last_event_seq;
	}
	if (overrides.turn_state !== undefined) {
		session.turn_state = overrides.turn_state;
	}
	if (overrides.message_count !== undefined) {
		session.message_count = overrides.message_count;
	}
	if (overrides.last_agent_message_id !== undefined) {
		session.last_agent_message_id = overrides.last_agent_message_id;
	}
	if (overrides.active_tool_call_ids !== undefined) {
		session.active_tool_call_ids = overrides.active_tool_call_ids;
	}
	if (overrides.completed_tool_call_ids !== undefined) {
		session.completed_tool_call_ids = overrides.completed_tool_call_ids;
	}
	if (overrides.last_terminal_turn_id !== undefined) {
		session.last_terminal_turn_id = overrides.last_terminal_turn_id;
	}

	return {
		session,
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

		store.applySessionProjection(
			createProjectionSnapshot({
				active_turn_failure: {
					turn_id: "turn-1",
					message: "Usage limit reached",
					code: "429",
					kind: "recoverable",
				},
			})
		);

		expect(store.getHotState("session-1")).toMatchObject({
			activeTurnFailure: {
				source: "unknown",
			},
		});
	});
});
