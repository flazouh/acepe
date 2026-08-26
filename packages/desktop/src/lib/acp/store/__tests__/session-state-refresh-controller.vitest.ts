import * as Effect from "effect/Effect";
import * as Result from "effect/Result";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SessionStateEnvelope } from "../../../services/acp-types.js";

vi.mock("../api.js", () => ({
	api: {
		fetchCanonicalSessionStateEnvelope: vi.fn(),
	},
}));

import { api } from "../api.js";
import { SessionNotFoundError } from "../../errors/app-error.js";
import { SessionStateRefreshController } from "../session-state-refresh-controller.svelte.js";

type MockReturnValue = {
	mockReturnValue: (value: unknown) => void;
};

// getSessionState (the only implementation behind fetchCanonicalSessionStateEnvelope
// under the Bun/Electrobun backend, see tauri-client/acp.ts's getSessionState) always
// answers with a "lifecycle" payload -- a narrower, intentional projection, not an
// error. It never returns "snapshot". A real session-not-found signal does not exist
// as a distinct payload kind on this endpoint today.
function lifecycleEnvelope(sessionId: string): SessionStateEnvelope {
	return {
		sessionId,
		graphRevision: 0,
		lastEventSeq: 0,
		payload: {
			kind: "lifecycle",
			lifecycle: {
				status: "ready",
				actionability: {
					canSend: true,
					canResume: false,
					canRetry: false,
					canArchive: true,
					canConfigure: true,
					recommendedAction: "send",
					recoveryPhase: "none",
					compactStatus: "ready",
				},
				failureReason: null,
				errorMessage: null,
				detachedReason: null,
			},
			revision: { graphRevision: 0, transcriptRevision: 0, lastEventSeq: 0 },
		},
	};
}

describe("SessionStateRefreshController", () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it("applies a real lifecycle-only envelope instead of reporting SESSION_NOT_FOUND", async () => {
		const envelope = lifecycleEnvelope("session-1");
		(
			api.fetchCanonicalSessionStateEnvelope as unknown as MockReturnValue
		).mockReturnValue(Effect.succeed(envelope));

		const applySessionStateEnvelope = vi.fn();
		const controller = new SessionStateRefreshController({ applySessionStateEnvelope });

		const result = await Effect.runPromise(
			Effect.result(controller.refreshSessionStateSnapshot("session-1"))
		);

		expect(Result.isSuccess(result)).toBe(true);
		expect(applySessionStateEnvelope).toHaveBeenCalledWith("session-1", envelope);
	});

	it("stops calling the server after repeated definitive failures for the same session", async () => {
		(api.fetchCanonicalSessionStateEnvelope as unknown as MockReturnValue).mockReturnValue(
			Effect.fail(new SessionNotFoundError("session-2"))
		);

		const controller = new SessionStateRefreshController({
			applySessionStateEnvelope: vi.fn(),
		});

		for (let attempt = 0; attempt < 3; attempt++) {
			const attemptResult = await Effect.runPromise(
				Effect.result(controller.refreshSessionStateSnapshot("session-2"))
			);
			expect(Result.isFailure(attemptResult)).toBe(true);
		}
		expect(controller.hasGivenUpOnSession("session-2")).toBe(true);
		expect(api.fetchCanonicalSessionStateEnvelope).toHaveBeenCalledTimes(3);

		await Effect.runPromise(Effect.result(controller.refreshSessionStateSnapshot("session-2")));

		// The 4th attempt fails fast without hitting the server again -- this is
		// what stops the 90+ second SESSION_NOT_FOUND hammering from AC #266.
		expect(api.fetchCanonicalSessionStateEnvelope).toHaveBeenCalledTimes(3);
	});
});
