import type {
	ActiveStreamingTail,
	AvailableModel,
	InteractionSnapshot,
	OperationSnapshot,
	PlanData,
	SessionGraphActivity,
	SessionGraphLifecycle,
	SessionGraphRevision,
	SessionStateDelta,
	SessionStateEnvelope,
	SessionStateField,
	SessionStateGraph,
	SessionTurnState,
	TranscriptDelta,
	TurnFailureSnapshot,
	UsageTelemetryData,
	ViewportBufferDelta,
	ViewportBufferPush,
} from "../../services/acp-types.js";
import {
	checkSessionStateEnvelopeByteBudget,
	type SessionStateEnvelopeByteBudgetResult,
} from "./session-state-envelope-budget.js";
import {
	resolveSessionStateDelta,
	type SessionStateDeltaResolution,
} from "./session-state-query-service.js";

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
			// #283: the mode a session runs in, on its own. Capabilities
			// otherwise reach the store as a whole projection, on the graph a
			// snapshot envelope carries, so a mode arriving mid-run needs a
			// command that changes the mode and leaves the models, the commands
			// and the config options in that projection alone.
			kind: "applySessionMode";
			currentModeId: string;
			revision: SessionGraphRevision;
	  }
	| {
			// The model a session runs, on its own, for the same reason as the
			// mode above. Before this existed, session.set-model changed the
			// composer's label and nothing else.
			kind: "applySessionModel";
			currentModelId: string;
			revision: SessionGraphRevision;
	  }
	| {
			// The models a session's provider reports it can run. A provider
			// answers once per session, after the snapshot that opened it, so
			// this replaces the catalog and leaves the chosen model alone.
			kind: "applySessionModels";
			availableModels: ReadonlyArray<AvailableModel>;
			revision: SessionGraphRevision;
	  }
	| {
			// One config option value a session chose, on its own, for the same
			// reason as the mode and model above: capabilities otherwise reach
			// the store whole, and a reasoning effort arriving mid-run must not
			// wipe the models and commands this envelope does not know.
			kind: "applySessionConfigOption";
			configId: string;
			value: string;
			revision: SessionGraphRevision;
	  }
	| {
			// Archived-ness is a SessionCold field, not graph state, so this
			// command carries no revision: the server owns `archived_at` and
			// the event that reports it is the only writer.
			kind: "applySessionArchive";
			archivedAtMs: number | null;
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
			/**
			 * A delta reporting a terminal turn failure for a session the store
			 * has no canonical graph for yet. The patches cannot be applied
			 * without a baseline, but the failure itself needs none: it says the
			 * turn is over. The reducer decides what that means for the session.
			 */
			kind: "applyPreBaselineTurnFailure";
			failure: TurnFailureSnapshot;
			fromRevision: number;
			toRevision: number;
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
		Object.hasOwn(delta as Record<string, unknown>, field);

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

/**
 * The failure a delta reports when it ends a turn as Failed, or null for every
 * other delta. A provider adapter that dies mid-request produces one of these.
 */
function terminalTurnFailureFrom(delta: SessionStateDelta): TurnFailureSnapshot | null {
	if (delta.turnState !== "Failed") {
		return null;
	}
	return delta.activeTurnFailure ?? null;
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
		case "sessionMode":
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
					kind: "applySessionMode",
					currentModeId: envelope.payload.currentModeId,
					revision: envelope.payload.revision,
				},
			];
		case "sessionModel":
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
					kind: "applySessionModel",
					currentModelId: envelope.payload.currentModelId,
					revision: envelope.payload.revision,
				},
			];
		case "sessionModels":
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
					kind: "applySessionModels",
					availableModels: envelope.payload.availableModels,
					revision: envelope.payload.revision,
				},
			];
		case "sessionConfigOption":
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
					kind: "applySessionConfigOption",
					configId: envelope.payload.configId,
					value: envelope.payload.value,
					revision: envelope.payload.revision,
				},
			];
		case "sessionArchive":
			return [
				{
					kind: "applySessionArchive",
					archivedAtMs: envelope.payload.archivedAtMs,
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
			const includesActiveStreamingTail = changedFields?.includes("activeStreamingTail") ?? false;
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
				const preBaselineFailure = terminalTurnFailureFrom(envelope.payload.delta);
				if (preBaselineFailure !== null) {
					return [
						{
							kind: "applyPreBaselineTurnFailure",
							failure: preBaselineFailure,
							fromRevision: envelope.payload.delta.fromRevision.graphRevision,
							toRevision: envelope.payload.delta.toRevision.graphRevision,
						},
					];
				}
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
