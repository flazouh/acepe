import type { ActivityPhase, ConnectionPhase } from "$lib/acp/logic/session-ui-state.js";

export interface LiveSessionPanelSyncInput {
	readonly sessionId: string;
	readonly updatedAtMs: number;
	readonly connectionPhase: ConnectionPhase | null;
	readonly activityPhase: ActivityPhase | null;
	readonly pendingQuestionId: string | null;
	readonly pendingPlanApprovalId: string | null;
	readonly pendingPermissionId: string | null;
}

export interface LiveSessionPanelSyncController {
	hasPanel(sessionId: string): boolean;
	syncSuppression(sessionId: string, signal: string): boolean;
	materialize(sessionId: string, width: number): void;
}

export function isLiveSessionPanelCandidate(input: LiveSessionPanelSyncInput): boolean {
	if (
		input.pendingQuestionId !== null ||
		input.pendingPlanApprovalId !== null ||
		input.pendingPermissionId !== null
	) {
		return true;
	}

	if (input.connectionPhase === "connecting" || input.connectionPhase === "failed") {
		return true;
	}

	if (input.connectionPhase !== "connected") {
		return false;
	}

	return input.activityPhase === "running" || input.activityPhase === "waiting_for_user";
}

export function buildLiveSessionPanelSignal(input: LiveSessionPanelSyncInput): string {
	const connectionPhase = input.connectionPhase !== null ? input.connectionPhase : "none";
	const activityPhase = input.activityPhase !== null ? input.activityPhase : "none";
	const pendingQuestionId = input.pendingQuestionId !== null ? input.pendingQuestionId : "none";
	const pendingPlanApprovalId =
		input.pendingPlanApprovalId !== null ? input.pendingPlanApprovalId : "none";
	const pendingPermissionId =
		input.pendingPermissionId !== null ? input.pendingPermissionId : "none";

	return [
		input.sessionId,
		String(input.updatedAtMs),
		connectionPhase,
		activityPhase,
		pendingQuestionId,
		pendingPlanApprovalId,
		pendingPermissionId,
	].join("|");
}

export function syncLiveSessionPanels(
	inputs: readonly LiveSessionPanelSyncInput[],
	controller: LiveSessionPanelSyncController,
	width: number
): readonly string[] {
	const materializedSessionIds: string[] = [];

	for (const input of inputs) {
		if (!isLiveSessionPanelCandidate(input)) {
			continue;
		}

		const signal = buildLiveSessionPanelSignal(input);
		const suppressed = controller.syncSuppression(input.sessionId, signal);
		if (suppressed || controller.hasPanel(input.sessionId)) {
			continue;
		}

		controller.materialize(input.sessionId, width);
		materializedSessionIds.push(input.sessionId);
	}

	return materializedSessionIds;
}
