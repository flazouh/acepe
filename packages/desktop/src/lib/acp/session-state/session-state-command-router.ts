import type {
	CapabilityPreviewState,
	InteractionSnapshot,
	OperationSnapshot,
	PlanData,
	SessionGraphActivity,
	SessionGraphCapabilities,
	SessionGraphLifecycle,
	SessionGraphRevision,
	SessionStateDelta,
	SessionStateField,
	ActiveStreamingTail,
	SessionStateEnvelope,
	SessionStateGraph,
	SessionTurnState,
	TranscriptDelta,
	TurnFailureSnapshot,
	UsageTelemetryData,
	ViewportBufferDelta,
	ViewportBufferPush,
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
			revision: SessionGraphRevision;
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
			revision: SessionGraphRevision;
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
			kind: "applyBufferPush";
			push: ViewportBufferPush;
	  }
	| {
			kind: "applyBufferDelta";
			delta: ViewportBufferDelta;
	  };

type CurrentSessionStateRevision = SessionGraphRevision | null | undefined;

function currentTranscriptRevisionFrom(
	currentRevision: CurrentSessionStateRevision
): number | undefined {
	if (currentRevision === null) {
		return undefined;
	}
	if (currentRevision === undefined) {
		return undefined;
	}
	return currentRevision.transcriptRevision;
}

function currentGraphRevisionFrom(
	currentRevision: CurrentSessionStateRevision
): number | undefined {
	if (currentRevision === null) {
		return undefined;
	}
	if (currentRevision === undefined) {
		return undefined;
	}
	return currentRevision.graphRevision;
}

function hasCurrentGraphRevision(currentRevision: CurrentSessionStateRevision): boolean {
	return typeof currentRevision === "object" && currentRevision !== null;
}

function envelopeFrontierMatchesRevision(
	envelope: Pick<SessionStateEnvelope, "graphRevision" | "lastEventSeq">,
	revision: Pick<SessionGraphRevision, "graphRevision" | "lastEventSeq">
): boolean {
	return (
		envelope.graphRevision === revision.graphRevision &&
		envelope.lastEventSeq === revision.lastEventSeq
	);
}

function commandFromDeltaResolution(
	resolution: SessionStateDeltaResolution,
	revision: SessionGraphRevision
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
					revision,
				},
			];
		case "noop":
			return [];
	}
}

function graphDeltaIsMissingRequiredPatches(
	changedFields: readonly SessionStateField[] | null,
	operationPatches: readonly OperationSnapshot[],
	interactionPatches: readonly InteractionSnapshot[]
): boolean {
	if (changedFields === null) {
		return false;
	}

	const operationsChanged = changedFields.includes("operations");
	if (operationsChanged && operationPatches.length === 0) {
		return true;
	}

	const interactionsChanged = changedFields.includes("interactions");
	if (interactionsChanged && interactionPatches.length === 0) {
		return true;
	}

	return false;
}

function graphDeltaIsMissingRequiredScalars(
	delta: SessionStateDelta,
	changedFields: readonly SessionStateField[] | null
): boolean {
	if (changedFields === null) {
		return false;
	}

	const hasOwn = (field: SessionStateField): boolean =>
		Object.prototype.hasOwnProperty.call(delta as Record<string, unknown>, field);

	for (const field of changedFields) {
		switch (field) {
			case "activity":
			case "turnState":
			case "activeTurnFailure":
			case "lastTerminalTurnId":
			case "activeStreamingTail":
				if (!hasOwn(field)) {
					return true;
				}
				break;
			case "transcriptSnapshot":
			case "operations":
			case "interactions":
				break;
		}
	}

	return false;
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
			if (envelope.payload.graph.canonicalSessionId !== envelope.sessionId) {
				return [
					{
						kind: "refreshSnapshot",
						fromRevision: envelope.payload.graph.revision.graphRevision,
						toRevision: envelope.graphRevision,
					},
				];
			}
			if (!envelopeFrontierMatchesRevision(envelope, envelope.payload.graph.revision)) {
				return [
					{
						kind: "refreshSnapshot",
						fromRevision: envelope.payload.graph.revision.graphRevision,
						toRevision: envelope.graphRevision,
					},
				];
			}
			return [
				{
					kind: "replaceGraph",
					graph: envelope.payload.graph,
				},
			];
		case "lifecycle":
			if (!envelopeFrontierMatchesRevision(envelope, envelope.payload.revision)) {
				return [
					{
						kind: "refreshSnapshot",
						fromRevision: envelope.payload.revision.graphRevision,
						toRevision: envelope.graphRevision,
					},
				];
			}
			return [
				{
					kind: "applyLifecycle",
					lifecycle: envelope.payload.lifecycle,
					revision: envelope.payload.revision,
				},
			];
		case "capabilities":
			if (!envelopeFrontierMatchesRevision(envelope, envelope.payload.revision)) {
				return [
					{
						kind: "refreshSnapshot",
						fromRevision: envelope.payload.revision.graphRevision,
						toRevision: envelope.graphRevision,
					},
				];
			}
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
			if (!envelopeFrontierMatchesRevision(envelope, envelope.payload.revision)) {
				return [
					{
						kind: "refreshSnapshot",
						fromRevision: envelope.payload.revision.graphRevision,
						toRevision: envelope.graphRevision,
					},
				];
			}
			return [
				{
					kind: "applyTelemetry",
					telemetry: envelope.payload.telemetry,
					revision: envelope.payload.revision,
				},
			];
		case "plan":
			if (!envelopeFrontierMatchesRevision(envelope, envelope.payload.revision)) {
				return [
					{
						kind: "refreshSnapshot",
						fromRevision: envelope.payload.revision.graphRevision,
						toRevision: envelope.graphRevision,
					},
				];
			}
			return [
				{
					kind: "applyPlan",
					plan: envelope.payload.plan,
					revision: envelope.payload.revision,
				},
			];
		case "delta": {
			if (!envelopeFrontierMatchesRevision(envelope, envelope.payload.delta.toRevision)) {
				return [
					{
						kind: "refreshSnapshot",
						fromRevision: envelope.payload.delta.fromRevision.graphRevision,
						toRevision: envelope.graphRevision,
					},
				];
			}
			const deltaEventSeqDidNotAdvance =
				envelope.payload.delta.toRevision.lastEventSeq <=
				envelope.payload.delta.fromRevision.lastEventSeq;
			if (deltaEventSeqDidNotAdvance) {
				return [
					{
						kind: "refreshSnapshot",
						fromRevision: envelope.payload.delta.fromRevision.graphRevision,
						toRevision: envelope.payload.delta.toRevision.graphRevision,
					},
				];
			}
			if (
				currentRevision !== null &&
				currentRevision !== undefined &&
				envelope.payload.delta.fromRevision.lastEventSeq !== currentRevision.lastEventSeq
			) {
				return [
					{
						kind: "refreshSnapshot",
						fromRevision: envelope.payload.delta.fromRevision.graphRevision,
						toRevision: envelope.payload.delta.toRevision.graphRevision,
					},
				];
			}
			const currentTranscriptRevision = currentTranscriptRevisionFrom(currentRevision);
			const resolution = resolveSessionStateDelta(
				sessionId,
				currentTranscriptRevision,
				envelope.payload.delta
			);
			const transcriptCommands = commandFromDeltaResolution(
				resolution,
				envelope.payload.delta.toRevision
			);
			if (resolution.kind === "refreshSnapshot") {
				return transcriptCommands;
			}
			const commands: SessionStateCommand[] = [];
			const operationPatches = envelope.payload.delta.operationPatches ?? [];
			const interactionPatches = envelope.payload.delta.interactionPatches ?? [];
			const changedFields = envelope.payload.delta.changedFields ?? null;
			const graphDeltaMissingRequiredPatches = graphDeltaIsMissingRequiredPatches(
				changedFields,
				operationPatches,
				interactionPatches
			);
			const graphDeltaMissingRequiredScalars = graphDeltaIsMissingRequiredScalars(
				envelope.payload.delta,
				changedFields
			);
			const includesActivity = changedFields?.includes("activity") ?? false;
			const includesTurnState = changedFields?.includes("turnState") ?? false;
			const includesActiveTurnFailure = changedFields?.includes("activeTurnFailure") ?? false;
			const includesLastTerminalTurnId = changedFields?.includes("lastTerminalTurnId") ?? false;
			const includesActiveStreamingTail =
				changedFields?.includes("activeStreamingTail") ?? false;
			const includesGraphState =
				includesActivity ||
				includesTurnState ||
				includesActiveTurnFailure ||
				includesLastTerminalTurnId ||
				includesActiveStreamingTail;
			const includesGraphPatch =
				operationPatches.length > 0 || interactionPatches.length > 0 || includesGraphState;
			const graphRevisionDidNotAdvance =
				includesGraphPatch &&
				envelope.payload.delta.toRevision.graphRevision <=
					envelope.payload.delta.fromRevision.graphRevision;
			if (graphDeltaMissingRequiredPatches || graphDeltaMissingRequiredScalars) {
				return [
					{
						kind: "refreshSnapshot",
						fromRevision: envelope.payload.delta.fromRevision.graphRevision,
						toRevision: envelope.payload.delta.toRevision.graphRevision,
					},
				];
			}
			if (graphRevisionDidNotAdvance) {
				return [
					{
						kind: "refreshSnapshot",
						fromRevision: envelope.payload.delta.fromRevision.graphRevision,
						toRevision: envelope.payload.delta.toRevision.graphRevision,
					},
				];
			}
			if (!hasCurrentGraphRevision(currentRevision)) {
				return [
					{
						kind: "refreshSnapshot",
						fromRevision: envelope.payload.delta.fromRevision.graphRevision,
						toRevision: envelope.payload.delta.toRevision.graphRevision,
					},
				];
			}
			const currentGraphRevision = currentGraphRevisionFrom(currentRevision);
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
		case "viewportBufferPush":
			if (!envelopeFrontierMatchesRevision(envelope, envelope.payload.push.graphRevision)) {
				return [
					{
						kind: "refreshSnapshot",
						fromRevision: envelope.payload.push.graphRevision.graphRevision,
						toRevision: envelope.graphRevision,
					},
				];
			}
			return [
				{
					kind: "applyBufferPush",
					push: envelope.payload.push,
				},
			];
		case "viewportBufferDelta":
			if (!envelopeFrontierMatchesRevision(envelope, envelope.payload.delta.graphRevision)) {
				return [
					{
						kind: "refreshSnapshot",
						fromRevision: envelope.payload.delta.graphRevision.graphRevision,
						toRevision: envelope.graphRevision,
					},
				];
			}
			return [
				{
					kind: "applyBufferDelta",
					delta: envelope.payload.delta,
				},
			];
	}
}
