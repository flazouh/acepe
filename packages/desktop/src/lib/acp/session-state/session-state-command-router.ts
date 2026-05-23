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
			kind: "rejectSessionMismatch";
			expectedSessionId: string;
			envelopeSessionId: string;
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
			revision: SessionGraphRevision;
	  }
	| {
			kind: "applyPlan";
			plan: PlanData;
			revision: SessionGraphRevision;
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
			activity: SessionGraphActivity | undefined;
			turnState: SessionTurnState | undefined;
			activeTurnFailure: TurnFailureSnapshot | null | undefined;
			lastTerminalTurnId: string | null | undefined;
			activeStreamingTail: ActiveStreamingTail | null | undefined;
			operationPatches: OperationSnapshot[];
			interactionPatches: InteractionSnapshot[];
	  }
	| {
			kind: "applyAssistantTextDelta";
			delta: AssistantTextDeltaPayload;
	  };

type CurrentSessionStateRevision = SessionGraphRevision | number | null | undefined;

function currentTranscriptRevisionFrom(
	currentRevision: CurrentSessionStateRevision
): number | undefined {
	if (typeof currentRevision === "number" || currentRevision === undefined) {
		return currentRevision;
	}
	if (currentRevision === null) {
		return undefined;
	}
	return currentRevision.transcriptRevision;
}

function currentGraphRevisionFrom(
	currentRevision: CurrentSessionStateRevision
): number | undefined {
	if (typeof currentRevision === "number" || currentRevision === undefined) {
		return undefined;
	}
	if (currentRevision === null) {
		return undefined;
	}
	return currentRevision.graphRevision;
}

function hasCurrentGraphRevision(currentRevision: CurrentSessionStateRevision): boolean {
	return typeof currentRevision === "object" && currentRevision !== null;
}

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
	currentRevision: CurrentSessionStateRevision,
	envelope: SessionStateEnvelope
): SessionStateCommand[] {
	if (envelope.sessionId !== sessionId) {
		return [
			{
				kind: "rejectSessionMismatch",
				expectedSessionId: sessionId,
				envelopeSessionId: envelope.sessionId,
			},
		];
	}

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
					revision: envelope.payload.revision,
				},
			];
		case "plan":
			return [
				{
					kind: "applyPlan",
					plan: envelope.payload.plan,
					revision: envelope.payload.revision,
				},
			];
		case "delta": {
			const currentTranscriptRevision = currentTranscriptRevisionFrom(currentRevision);
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
			const includesGraphPatch =
				operationPatches.length > 0 || interactionPatches.length > 0 || includesGraphState;
			const currentGraphRevision = currentGraphRevisionFrom(currentRevision);
			if (includesGraphPatch && !hasCurrentGraphRevision(currentRevision)) {
				return [
					{
						kind: "refreshSnapshot",
						fromRevision: envelope.payload.delta.fromRevision.graphRevision,
						toRevision: envelope.payload.delta.toRevision.graphRevision,
					},
				];
			}
			if (
				includesGraphPatch &&
				hasCurrentGraphRevision(currentRevision) &&
				envelope.payload.delta.fromRevision.graphRevision !== currentGraphRevision
			) {
				return [
					{
						kind: "refreshSnapshot",
						fromRevision: envelope.payload.delta.fromRevision.graphRevision,
						toRevision: envelope.payload.delta.toRevision.graphRevision,
					},
				];
			}
			for (const command of transcriptCommands) {
				commands.push(command);
			}
			if (includesGraphPatch) {
				commands.push({
					kind: "applyGraphPatches",
					revision: envelope.payload.delta.toRevision,
					activity: includesActivity ? envelope.payload.delta.activity : undefined,
					turnState: includesTurnState ? envelope.payload.delta.turnState : undefined,
					activeTurnFailure: includesActiveTurnFailure
						? (envelope.payload.delta.activeTurnFailure ?? null)
						: undefined,
					lastTerminalTurnId: includesLastTerminalTurnId
						? (envelope.payload.delta.lastTerminalTurnId ?? null)
						: undefined,
					activeStreamingTail: includesActiveStreamingTail
						? (envelope.payload.delta.activeStreamingTail ?? null)
						: undefined,
					operationPatches,
					interactionPatches,
				});
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
