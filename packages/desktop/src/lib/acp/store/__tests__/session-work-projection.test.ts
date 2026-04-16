import { describe, expect, it } from "bun:test";

import type { SessionState } from "../session-state.js";
import {
	deriveSessionWorkProjection,
	selectLegacySessionStatus,
	selectQueueWorkBucket,
	selectSessionWorkBucket,
} from "../session-work-projection.js";

function makeState(
	options: {
		connection?: SessionState["connection"];
		activityKind?: SessionState["activity"]["kind"];
		modeId?: string | null;
		pendingInputKind?: SessionState["pendingInput"]["kind"];
		hasUnseenCompletion?: boolean;
	} = {}
): SessionState {
	const connection = options.connection ?? "connected";
	const activityKind = options.activityKind ?? "idle";
	const modeId = options.modeId ?? null;
	const pendingInputKind = options.pendingInputKind ?? "none";
	const hasUnseenCompletion = options.hasUnseenCompletion ?? false;

	let activity: SessionState["activity"];
	if (activityKind === "streaming") {
		activity = { kind: "streaming", modeId, tool: null };
	} else if (activityKind === "thinking") {
		activity = { kind: "thinking" };
	} else if (activityKind === "paused") {
		activity = { kind: "paused" };
	} else {
		activity = { kind: "idle" };
	}

	let pendingInput: SessionState["pendingInput"];
	if (pendingInputKind === "question") {
		pendingInput = { kind: "question", request: { id: "q-1", sessionId: "s-1", questions: [] } };
	} else if (pendingInputKind === "plan_approval") {
		pendingInput = {
			kind: "plan_approval",
			request: {
				id: "plan-1",
				kind: "plan_approval",
				source: "create_plan",
				sessionId: "s-1",
				tool: { messageID: "", callID: "tool-1" },
				jsonRpcRequestId: 1,
				replyHandler: { kind: "json-rpc", requestId: 1 },
				status: "pending",
			},
		};
	} else if (pendingInputKind === "permission") {
		pendingInput = {
			kind: "permission",
			request: {
				id: "p-1",
				sessionId: "s-1",
				permission: "test",
				patterns: [],
				metadata: {},
				always: [],
			},
		};
	} else {
		pendingInput = { kind: "none" };
	}

	return {
		connection,
		activity,
		pendingInput,
		attention: { hasUnseenCompletion },
	};
}

describe("deriveSessionWorkProjection", () => {
	it("uses streaming mode when currentModeId is absent", () => {
		const projection = deriveSessionWorkProjection({
			state: makeState({ activityKind: "streaming", modeId: "plan" }),
			currentModeId: null,
			connectionError: null,
		});

		expect(projection.effectiveModeId).toBe("plan");
		expect(projection.intentFamily).toBe("planning");
		expect(selectSessionWorkBucket(projection)).toBe("planning");
	});

	it("classifies active non-plan work as working", () => {
		const projection = deriveSessionWorkProjection({
			state: makeState({ activityKind: "thinking" }),
			currentModeId: "build",
			connectionError: null,
		});

		expect(projection.intentFamily).toBe("working");
		expect(selectSessionWorkBucket(projection)).toBe("working");
	});

	it("keeps paused plan work in the planning family", () => {
		const projection = deriveSessionWorkProjection({
			state: makeState({ activityKind: "paused" }),
			currentModeId: "plan",
			connectionError: null,
		});

		expect(projection.compactActivityKind).toBe("paused");
		expect(projection.intentFamily).toBe("planning");
		expect(selectSessionWorkBucket(projection)).toBe("planning");
	});

	it("classifies idle unseen completion as needs_review", () => {
		const projection = deriveSessionWorkProjection({
			state: makeState({ hasUnseenCompletion: true }),
			currentModeId: null,
			connectionError: null,
		});

		expect(projection.needsReview).toBe(true);
		expect(projection.acknowledgeable).toBe(true);
		expect(selectSessionWorkBucket(projection)).toBe("needs_review");
	});

	it("returns idle when the completion has already been seen", () => {
		const projection = deriveSessionWorkProjection({
			state: makeState({ hasUnseenCompletion: false }),
			currentModeId: null,
			connectionError: null,
		});

		expect(projection.needsReview).toBe(false);
		expect(selectSessionWorkBucket(projection)).toBe("idle");
		expect(selectQueueWorkBucket(projection)).toBeNull();
	});

	it("prioritizes pending input over error", () => {
		const projection = deriveSessionWorkProjection({
			state: makeState({
				connection: "error",
				pendingInputKind: "permission",
				hasUnseenCompletion: true,
			}),
			currentModeId: null,
			connectionError: "Session failed",
		});

		expect(projection.hasSecondaryError).toBe(true);
		expect(selectSessionWorkBucket(projection)).toBe("answer_needed");
		expect(selectQueueWorkBucket(projection)).toBe("answer_needed");
	});

	it("returns error when no pending input remains", () => {
		const projection = deriveSessionWorkProjection({
			state: makeState({ connection: "error" }),
			currentModeId: null,
			connectionError: "Session failed",
		});

		expect(projection.hasError).toBe(true);
		expect(selectSessionWorkBucket(projection)).toBe("error");
		expect(selectQueueWorkBucket(projection)).toBe("error");
	});

	it("maps connectionError-only projections to legacy error status", () => {
		const projection = deriveSessionWorkProjection({
			state: makeState(),
			currentModeId: null,
			connectionError: "Resume failed",
		});

		expect(projection.hasError).toBe(true);
		expect(selectLegacySessionStatus(projection)).toBe("error");
	});

	it("maps active turn failure to error without a connection-level error", () => {
		const projection = deriveSessionWorkProjection({
			state: makeState(),
			currentModeId: null,
			connectionError: null,
			activeTurnFailure: {
				turnId: "turn-1",
				message: "Usage limit reached",
				code: "429",
				kind: "recoverable",
				source: "process",
			},
		});

		expect(projection.hasError).toBe(true);
		expect(selectSessionWorkBucket(projection)).toBe("error");
		expect(selectLegacySessionStatus(projection)).toBe("error");
	});
});
