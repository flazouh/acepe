import { describe, expect, it } from "bun:test";

import type { SessionGraphLifecycle } from "$lib/services/acp-types.js";
import { mapCanonicalSessionToPanelStatus, mapSessionStatusToUI } from "../session-status-mapper";

function lifecycle(
	status: SessionGraphLifecycle["status"],
	canResume = false,
	canRetry = false,
	canSend = status === "ready"
): SessionGraphLifecycle {
	return {
		status,
		detachedReason: status === "detached" ? "restoredRequiresAttach" : null,
		failureReason: status === "failed" ? "resumeFailed" : null,
		errorMessage: status === "failed" ? "Connection failed" : null,
		actionability: {
			canSend,
			canResume,
			canRetry,
			canArchive: status !== "archived",
			canConfigure: canSend,
			recommendedAction: canSend ? "send" : canResume ? "resume" : canRetry ? "retry" : "wait",
			recoveryPhase:
				status === "detached"
					? "detached"
					: status === "failed"
						? "failed"
						: status === "activating"
							? "activating"
							: status === "reconnecting"
								? "reconnecting"
								: status === "archived"
									? "archived"
									: "none",
			compactStatus: status,
		},
	};
}

describe("mapSessionStatusToUI", () => {
	it('should map "idle" to "empty"', () => {
		expect(mapSessionStatusToUI("idle")).toBe("empty");
	});

	it('should map "connecting" to "warming"', () => {
		expect(mapSessionStatusToUI("connecting")).toBe("warming");
	});

	it('should map "ready" to "connected"', () => {
		expect(mapSessionStatusToUI("ready")).toBe("connected");
	});

	it('should map "streaming" to "connected"', () => {
		expect(mapSessionStatusToUI("streaming")).toBe("connected");
	});

	it('should map "error" to "error"', () => {
		expect(mapSessionStatusToUI("error")).toBe("error");
	});

	it('should map undefined to "empty"', () => {
		expect(mapSessionStatusToUI(undefined)).toBe("empty");
	});

	it('should map null to "empty"', () => {
		expect(mapSessionStatusToUI(null)).toBe("empty");
	});

	it('should map unknown status to "empty"', () => {
		expect(mapSessionStatusToUI("loading" as never)).toBe("empty");
	});

	it('should map "paused" to "empty"', () => {
		expect(mapSessionStatusToUI("paused")).toBe("empty");
	});
});

describe("mapCanonicalSessionToPanelStatus", () => {
	it("maps ready/sendable lifecycle to connected presentation", () => {
		expect(
			mapCanonicalSessionToPanelStatus({
				lifecycle: lifecycle("ready"),
				activity: {
					kind: "idle",
					activeOperationCount: 0,
					activeSubagentCount: 0,
					dominantOperationId: null,
					blockingInteractionId: null,
				},
				turnState: "Idle",
				hasEntries: true,
			})
		).toBe("connected");
	});

	it("maps detached/restorable lifecycle to idle instead of empty", () => {
		expect(
			mapCanonicalSessionToPanelStatus({
				lifecycle: lifecycle("detached", true),
				activity: {
					kind: "paused",
					activeOperationCount: 0,
					activeSubagentCount: 0,
					dominantOperationId: null,
					blockingInteractionId: null,
				},
				turnState: "Idle",
				hasEntries: true,
			})
		).toBe("idle");
	});

	it("maps reserved and activating lifecycle to warming explicitly", () => {
		expect(mapCanonicalSessionToPanelStatus({ lifecycle: lifecycle("reserved") })).toBe("warming");
		expect(mapCanonicalSessionToPanelStatus({ lifecycle: lifecycle("activating") })).toBe(
			"warming"
		);
	});

	it("maps failed retryable lifecycle to error presentation", () => {
		expect(mapCanonicalSessionToPanelStatus({ lifecycle: lifecycle("failed", false, true) })).toBe(
			"error"
		);
	});

	it("maps archived lifecycle to idle read-only presentation", () => {
		expect(mapCanonicalSessionToPanelStatus({ lifecycle: lifecycle("archived") })).toBe("idle");
	});
});
