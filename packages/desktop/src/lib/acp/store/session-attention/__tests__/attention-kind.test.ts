import { describe, expect, it } from "bun:test";
import {
	createAttentionMeta,
	createConnectedIdleState,
	createDisconnectedState,
	type SessionState,
} from "../../session-state.js";
import type { SessionWorkProjection } from "../../session-work-projection.js";
import { selectAttentionKind } from "../attention-kind.js";

function projection(overrides: {
	readonly hasPendingInput?: boolean;
	readonly hasError?: boolean;
	readonly needsReview?: boolean;
	readonly intentFamily?: SessionWorkProjection["intentFamily"];
}): SessionWorkProjection {
	const state: SessionState = createConnectedIdleState();
	return {
		state,
		currentModeId: null,
		effectiveModeId: null,
		canonicalActivity: "idle",
		intentFamily: overrides.intentFamily ?? "none",
		compactActivityKind: "idle",
		hasPendingInput: overrides.hasPendingInput ?? false,
		hasError: overrides.hasError ?? false,
		hasSecondaryError: false,
		needsReview: overrides.needsReview ?? false,
		acknowledgeable: overrides.needsReview ?? false,
	};
}

describe("selectAttentionKind", () => {
	it("returns answer_needed when pending input is present", () => {
		expect(selectAttentionKind(projection({ hasPendingInput: true }))).toBe("answer_needed");
	});

	it("returns error when the session has an error", () => {
		expect(selectAttentionKind(projection({ hasError: true }))).toBe("error");
	});

	it("returns needs_review for idle unseen completions", () => {
		const reviewProjection = projection({ needsReview: true });
		expect(reviewProjection.state.attention).toEqual(createAttentionMeta(false));
		expect(selectAttentionKind(reviewProjection)).toBe("needs_review");
	});

	it("ignores working and planning buckets", () => {
		expect(selectAttentionKind(projection({ intentFamily: "working" }))).toBeNull();
		expect(selectAttentionKind(projection({ intentFamily: "planning" }))).toBeNull();
	});

	it("returns null for idle disconnected sessions", () => {
		const idle: SessionWorkProjection = {
			state: createDisconnectedState(),
			currentModeId: null,
			effectiveModeId: null,
			canonicalActivity: "idle",
			intentFamily: "none",
			compactActivityKind: "idle",
			hasPendingInput: false,
			hasError: false,
			hasSecondaryError: false,
			needsReview: false,
			acknowledgeable: false,
		};
		expect(selectAttentionKind(idle)).toBeNull();
	});
});
