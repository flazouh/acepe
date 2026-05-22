import type {
	AssistantTextDeltaPayload,
	CapabilityPreviewState,
	InteractionSnapshot,
	OperationSnapshot,
	PlanData,
	SessionGraphActivity,
	SessionGraphCapabilities,
	SessionGraphLifecycle,
	SessionGraphRevision,
	ActiveStreamingTail,
	SessionStateEnvelope,
	SessionStateGraph,
	SessionTurnState,
	TranscriptDelta,
	TurnFailureSnapshot,
	UsageTelemetryData,
} from "../../services/acp-types.js";
import {
	resolveSessionStateDelta,
	type SessionStateDeltaResolution,
} from "./session-state-query-service.js";
import {
	checkSessionStateEnvelopeByteBudget,
	type SessionStateEnvelopeByteBudgetResult,
} from "./session-state-envelope-budget.js";

export type SessionStateCommand =
	| {
			kind: "rejectOversizedEnvelope";
			budget: SessionStateEnvelopeByteBudgetResult;
	  }
	| {
			kind: "replaceGraph";
			graph: SessionStateGraph;
	  }
	| {
			kind: "applyLifecycle";
			lifecycle: SessionGraphLifecycle;
	  }
	| {
			kind: "applyCapabilities";
			capabilities: SessionGraphCapabilities;
			revision: SessionGraphRevision;
			pendingMutationId: string | null;
			previewState: CapabilityPreviewState;
	  }
	| {
			kind: "applyTelemetry";
			telemetry: UsageTelemetryData;
	  }
	| {
			kind: "applyPlan";
			plan: PlanData;
	  }
	| {
			kind: "refreshSnapshot";
			fromRevision: number;
			toRevision: number;
	  }
	| {
			kind: "applyTranscriptDelta";
			delta: TranscriptDelta;
	  }
	| {
			kind: "applyGraphPatches";
			revision: SessionGraphRevision;
			activity: SessionGraphActivity;
			turnState: SessionTurnState;
			activeTurnFailure: TurnFailureSnapshot | null;
			lastTerminalTurnId: string | null;
			activeStreamingTail: ActiveStreamingTail | null | undefined;
			operationPatches: OperationSnapshot[];
			interactionPatches: InteractionSnapshot[];
	  }
	| {
			kind: "applyAssistantTextDelta";
			delta: AssistantTextDeltaPayload;
	  };

function commandFromDeltaResolution(
	resolution: SessionStateDeltaResolution
): SessionStateCommand[] {
	switch (resolution.kind) {
		case "refreshSnapshot":
			return [
				{
					kind: "refreshSnapshot",
					fromRevision: resolution.fromRevision,
					toRevision: resolution.toRevision,
				},
			];
		case "applyTranscriptDelta":
			return [
				{
					kind: "applyTranscriptDelta",
					delta: resolution.delta,
				},
			];
		case "noop":
			return [];
	}
}

export function routeSessionStateEnvelope(
	sessionId: string,
	currentTranscriptRevision: number | undefined,
	envelope: SessionStateEnvelope
): SessionStateCommand[] {
	const budget = checkSessionStateEnvelopeByteBudget(envelope);
	if (!budget.ok) {
		return [
			{
				kind: "rejectOversizedEnvelope",
				budget,
			},
		];
	}

	switch (envelope.payload.kind) {
		case "snapshot":
			return [
				{
					kind: "replaceGraph",
					graph: envelope.payload.graph,
				},
			];
		case "lifecycle":
			return [
				{
					kind: "applyLifecycle",
					lifecycle: envelope.payload.lifecycle,
				},
			];
		case "capabilities":
			return [
				{
					kind: "applyCapabilities",
					capabilities: envelope.payload.capabilities,
					revision: envelope.payload.revision,
					pendingMutationId: envelope.payload.pending_mutation_id ?? null,
					previewState: envelope.payload.preview_state,
				},
			];
		case "telemetry":
			return [
				{
					kind: "applyTelemetry",
					telemetry: envelope.payload.telemetry,
				},
			];
		case "plan":
			return [
				{
					kind: "applyPlan",
					plan: envelope.payload.plan,
				},
			];
		case "delta": {
			const resolution = resolveSessionStateDelta(
				sessionId,
				currentTranscriptRevision,
				envelope.payload.delta
			);
			const transcriptCommands = commandFromDeltaResolution(resolution);
			if (resolution.kind === "refreshSnapshot") {
				return transcriptCommands;
			}
			const commands: SessionStateCommand[] = [];
			const operationPatches = envelope.payload.delta.operationPatches ?? [];
			const interactionPatches = envelope.payload.delta.interactionPatches ?? [];
			const changedFields = envelope.payload.delta.changedFields ?? null;
			const includesActivity = changedFields?.includes("activity") ?? false;
			const includesTurnState = changedFields?.includes("turnState") ?? false;
			const includesActiveTurnFailure = changedFields?.includes("activeTurnFailure") ?? false;
			const includesLastTerminalTurnId = changedFields?.includes("lastTerminalTurnId") ?? false;
			const includesActiveStreamingTail =
				changedFields?.includes("activeStreamingTail") ?? false;
			const includesGraphState =
				changedFields === null ||
				includesActivity ||
				includesTurnState ||
				includesActiveTurnFailure ||
				includesLastTerminalTurnId ||
				includesActiveStreamingTail;
			if (
				operationPatches.length > 0 ||
				interactionPatches.length > 0 ||
				includesGraphState
			) {
				commands.push({
					kind: "applyGraphPatches",
					revision: envelope.payload.delta.toRevision,
					activity: envelope.payload.delta.activity,
					turnState: envelope.payload.delta.turnState,
					activeTurnFailure: envelope.payload.delta.activeTurnFailure ?? null,
					lastTerminalTurnId: envelope.payload.delta.lastTerminalTurnId ?? null,
					activeStreamingTail: includesActiveStreamingTail
						? (envelope.payload.delta.activeStreamingTail ?? null)
						: undefined,
					operationPatches,
					interactionPatches,
				});
			}
			for (const command of transcriptCommands) {
				commands.push(command);
			}
			return commands;
		}
		case "assistantTextDelta":
			return [
				{
					kind: "applyAssistantTextDelta",
					delta: envelope.payload.delta,
				},
			];
	}
}
