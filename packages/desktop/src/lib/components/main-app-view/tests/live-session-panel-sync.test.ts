import { describe, expect, it } from "bun:test";

import {
	buildLiveSessionPanelSignal,
	isLiveSessionPanelCandidate,
	syncLiveSessionPanels,
	type LiveSessionPanelSyncController,
	type LiveSessionPanelSyncInput,
} from "../logic/live-session-panel-sync.js";

function makeInput(
	overrides: Partial<LiveSessionPanelSyncInput> = {}
): LiveSessionPanelSyncInput {
	return {
		sessionId: overrides.sessionId !== undefined ? overrides.sessionId : "session-1",
		updatedAtMs: overrides.updatedAtMs !== undefined ? overrides.updatedAtMs : 1000,
		connectionPhase:
			overrides.connectionPhase !== undefined ? overrides.connectionPhase : "connected",
		activityPhase: overrides.activityPhase !== undefined ? overrides.activityPhase : "running",
		pendingQuestionId:
			overrides.pendingQuestionId !== undefined ? overrides.pendingQuestionId : null,
		pendingPlanApprovalId:
			overrides.pendingPlanApprovalId !== undefined ? overrides.pendingPlanApprovalId : null,
		pendingPermissionId:
			overrides.pendingPermissionId !== undefined ? overrides.pendingPermissionId : null,
	};
}

function createController(
	initialPanels: readonly string[] = [],
	initialSuppressedSignals: ReadonlyMap<string, string> = new Map<string, string>()
): {
	readonly controller: LiveSessionPanelSyncController;
	readonly materializedSessionIds: string[];
	readonly panels: Set<string>;
	readonly suppressedSignals: Map<string, string>;
	readonly latestSignals: Map<string, string>;
} {
	const materializedSessionIds: string[] = [];
	const panels = new Set<string>(initialPanels);
	const suppressedSignals = new Map<string, string>(initialSuppressedSignals);
	const latestSignals = new Map<string, string>();

	return {
		controller: {
			hasPanel(sessionId: string): boolean {
				return panels.has(sessionId);
			},
			syncSuppression(sessionId: string, signal: string): boolean {
				latestSignals.set(sessionId, signal);
				const suppressed = suppressedSignals.get(sessionId);
				if (suppressed === undefined) {
					return false;
				}
				if (suppressed === signal) {
					return true;
				}
				suppressedSignals.delete(sessionId);
				return false;
			},
			materialize(sessionId: string): void {
				panels.add(sessionId);
				materializedSessionIds.push(sessionId);
			},
		},
		materializedSessionIds,
		panels,
		suppressedSignals,
		latestSignals,
	};
}

describe("isLiveSessionPanelCandidate", () => {
	it("treats running sessions as live", () => {
		expect(isLiveSessionPanelCandidate(makeInput())).toBe(true);
	});

	it("treats waiting-for-user sessions as live", () => {
		expect(
			isLiveSessionPanelCandidate(makeInput({ activityPhase: "waiting_for_user" }))
		).toBe(true);
	});

	it("treats failed sessions as live", () => {
		expect(
			isLiveSessionPanelCandidate(makeInput({ connectionPhase: "failed", activityPhase: "idle" }))
		).toBe(true);
	});

	it("treats connected idle sessions without pending input as not live", () => {
		expect(
			isLiveSessionPanelCandidate(makeInput({ activityPhase: "idle", connectionPhase: "connected" }))
		).toBe(false);
	});

	it("treats pending questions as live even when idle", () => {
		expect(
			isLiveSessionPanelCandidate(
				makeInput({ activityPhase: "idle", pendingQuestionId: "question-1" })
			)
		).toBe(true);
	});

	it("treats pending plan approvals as live even when idle", () => {
		expect(
			isLiveSessionPanelCandidate(
				makeInput({ activityPhase: "idle", pendingPlanApprovalId: "plan-approval-1" })
			)
		).toBe(true);
	});
});

describe("syncLiveSessionPanels", () => {
	it("materializes live sessions that do not yet have panels", () => {
		const { controller, materializedSessionIds } = createController();

		const synchronized = syncLiveSessionPanels([makeInput({ sessionId: "session-1" })], controller, 450);

		expect(synchronized).toEqual(["session-1"]);
		expect(materializedSessionIds).toEqual(["session-1"]);
	});

	it("does not materialize non-live sessions", () => {
		const { controller, materializedSessionIds } = createController();

		const synchronized = syncLiveSessionPanels(
			[makeInput({ sessionId: "session-1", connectionPhase: "connected", activityPhase: "idle" })],
			controller,
			450
		);

		expect(synchronized).toEqual([]);
		expect(materializedSessionIds).toEqual([]);
	});

	it("does not rematerialize a session when the dismissal suppression signal still matches", () => {
		const input = makeInput({ sessionId: "session-1", updatedAtMs: 1000 });
		const signal = buildLiveSessionPanelSignal(input);
		const { controller, materializedSessionIds } = createController([], new Map([["session-1", signal]]));

		const synchronized = syncLiveSessionPanels([input], controller, 450);

		expect(synchronized).toEqual([]);
		expect(materializedSessionIds).toEqual([]);
	});

	it("clears suppression and rematerializes when the live signal changes", () => {
		const previousSignal = buildLiveSessionPanelSignal(
			makeInput({ sessionId: "session-1", updatedAtMs: 1000 })
		);
		const { controller, materializedSessionIds, suppressedSignals } = createController(
			[],
			new Map([["session-1", previousSignal]])
		);

		const synchronized = syncLiveSessionPanels(
			[makeInput({ sessionId: "session-1", updatedAtMs: 2000 })],
			controller,
			450
		);

		expect(synchronized).toEqual(["session-1"]);
		expect(materializedSessionIds).toEqual(["session-1"]);
		expect(suppressedSignals.has("session-1")).toBe(false);
	});

	it("does not materialize sessions that already have panels", () => {
		const { controller, materializedSessionIds } = createController(["session-1"]);

		const synchronized = syncLiveSessionPanels([makeInput({ sessionId: "session-1" })], controller, 450);

		expect(synchronized).toEqual([]);
		expect(materializedSessionIds).toEqual([]);
	});
});
