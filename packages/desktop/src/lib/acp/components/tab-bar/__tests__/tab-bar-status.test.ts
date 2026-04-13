import { describe, expect, it } from "bun:test";

import {
	createAttentionMeta,
	createIdleActivity,
	createNoPendingInput,
	createPausedActivity,
	createPendingPermission,
	createThinkingActivity,
	type SessionState,
} from "../../../store/session-state.js";
import type { PermissionRequest } from "../../../types/permission.js";
import { deriveAppTabStatus } from "../tab-bar-status.js";

function makeState(overrides: Partial<SessionState> = {}): SessionState {
	return {
		connection: "connected",
		activity: createIdleActivity(),
		pendingInput: createNoPendingInput(),
		attention: createAttentionMeta(false),
		...overrides,
	};
}

describe("deriveAppTabStatus", () => {
	it("shows permission-pending tabs as question state", () => {
		const permissionRequest: PermissionRequest = {
			id: "permission-1",
			sessionId: "session-1",
			permission: "write",
			patterns: [],
			metadata: {},
			always: [],
		};

		expect(
			deriveAppTabStatus({
				isUnseen: false,
				workBucket: "answer_needed",
				state: makeState({
					pendingInput: createPendingPermission(permissionRequest),
				}),
			})
		).toBe("question");
	});

	it("keeps paused planning tabs out of running state", () => {
		expect(
			deriveAppTabStatus({
				isUnseen: false,
				workBucket: "planning",
				state: makeState({
					activity: createPausedActivity(),
				}),
			})
		).toBe("idle");
	});

	it("shows active thinking work as running", () => {
		expect(
			deriveAppTabStatus({
				isUnseen: false,
				workBucket: "working",
				state: makeState({
					activity: createThinkingActivity(),
				}),
			})
		).toBe("running");
	});
});
