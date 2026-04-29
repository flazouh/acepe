import type {
	CapabilityPreviewState,
	InteractionSnapshot,
	OperationSnapshot,
	PlanData,
	SessionGraphActivity,
	SessionGraphCapabilities,
	SessionGraphLifecycle,
	SessionGraphRevision,
	SessionStateEnvelope,
	SessionStateGraph,
	SessionTurnState,
	TurnFailureSnapshot,
	TranscriptDelta,
	UsageTelemetryData,
} from "../../services/acp-types.js";
import {
	resolveSessionStateDelta,
	type SessionStateDeltaResolution,
} from "./session-state-query-service.js";

export type SessionStateCommand =
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
			operationPatches: OperationSnapshot[];
			interactionPatches: InteractionSnapshot[];
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
			const commands = commandFromDeltaResolution(resolution);
			if (resolution.kind === "refreshSnapshot") {
				return commands;
			}
			const operationPatches = envelope.payload.delta.operationPatches ?? [];
			const interactionPatches = envelope.payload.delta.interactionPatches ?? [];
			const includesActivity =
				envelope.payload.delta.changedFields?.includes("activity") ?? false;
			if (operationPatches.length > 0 || interactionPatches.length > 0 || includesActivity) {
				commands.push({
					kind: "applyGraphPatches",
					revision: envelope.payload.delta.toRevision,
					activity: envelope.payload.delta.activity,
					turnState: envelope.payload.delta.turnState,
					activeTurnFailure: envelope.payload.delta.activeTurnFailure ?? null,
					lastTerminalTurnId: envelope.payload.delta.lastTerminalTurnId ?? null,
					operationPatches,
					interactionPatches,
				});
			}
			return commands;
		}
	}
}
