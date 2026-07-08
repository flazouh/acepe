import { describe, expect, it } from "bun:test";
import type { OpenPersistedSessionDiagnosticEvent } from "../logic/open-persisted-session.js";
import { shouldWaitForSessionOpenResult } from "../logic/session-open-content-probe.js";

function event(
	stage: OpenPersistedSessionDiagnosticEvent["stage"]
): OpenPersistedSessionDiagnosticEvent {
	return {
		stage,
		source: "session-handler",
		panelId: "panel-1",
		sessionId: "session-1",
		elapsedMs: 1,
		canonicalSessionId: null,
		outcome: null,
		message: null,
		hasSessionIdentity: null,
		hasSessionMetadata: null,
		shouldAttemptLocalReattach: false,
		hasInitialViewportEnvelope: null,
		initialRowPageRowCount: null,
		initialRowPageTotalRowCount: null,
		initialRowPageStartRowIndex: null,
		initialRowPagePayloadBytes: null,
		openResultTiming: null,
	};
}

describe("session open content probe", () => {
	it("waits when rows are visible but the restored-open result is still pending", () => {
		expect(shouldWaitForSessionOpenResult([event("started"), event("request-started")])).toBe(true);
	});

	it("stops waiting once the restored-open result reaches a terminal diagnostic stage", () => {
		expect(
			shouldWaitForSessionOpenResult([
				event("started"),
				event("request-started"),
				event("result-found"),
			])
		).toBe(false);
		expect(
			shouldWaitForSessionOpenResult([
				event("started"),
				event("request-started"),
				event("request-failed"),
			])
		).toBe(false);
		expect(
			shouldWaitForSessionOpenResult([
				event("started"),
				event("request-started"),
				event("stale-panel"),
			])
		).toBe(false);
	});

	it("does not wait when no restored-open request was started", () => {
		expect(shouldWaitForSessionOpenResult([event("started")])).toBe(false);
	});
});
