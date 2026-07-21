import type {
	ActiveStreamingTail,
	SessionGraphActivity,
	SessionGraphCapabilities,
	SessionGraphRevision,
	SessionStateGraph,
	SessionTurnState,
	TranscriptDelta,
	TranscriptSnapshot,
} from "../../../services/acp-types.js";
import type { SessionStateCommand } from "../../session-state/session-state-command-router.js";
import { sanitizeCanonicalCapabilities } from "../canonical-config-sanitize.js";
import {
	graphWithCapabilities,
	graphWithLifecycle,
	graphWithPatches,
	graphWithTranscriptSnapshot,
} from "../session-graph-builders.js";
import { applyTranscriptDeltaToSnapshot } from "../transcript-delta.js";
import type { SessionTransientProjection } from "../types.js";
import { buildCanonicalUsageTelemetry } from "./canonical-usage-telemetry.js";
import { emptySessionGraphCapabilities } from "./empty-session-graph-capabilities.js";
import type { EnvelopePatch } from "./envelope-patch.js";
import type { EnvelopeReducerSnapshot } from "./envelope-snapshot.js";
import { isNewerGraphRevision, isOlderGraphRevision } from "./graph-revision-order.js";
import { createLifecycleOnlyGraph } from "./lifecycle-only-graph.js";
import {
	mergeSessionGraphActivityTiming,
	seedSessionGraphActivityTimingIfNeeded,
} from "./merge-session-graph-activity-timing.js";
import { mapProjectionTurnFailure } from "./projection-turn-failure.js";
import { defaultIdleActivity, reconcileStoredGraphActivity } from "./reconcile-graph-activity.js";

function terminalTurnState(turnState: SessionTurnState | null | undefined): boolean {
	return turnState === "Completed" || turnState === "Failed" || turnState === "Cancelled";
}

function activityForGraphPatch(input: {
	readonly commandActivity: SessionGraphActivity | undefined;
	readonly previousActivity: SessionGraphActivity;
	readonly nextTurnState: SessionTurnState;
}): SessionGraphActivity {
	if (input.commandActivity !== undefined) {
		return mergeSessionGraphActivityTiming(
			input.previousActivity,
			input.commandActivity,
			Date.now()
		);
	}

	return terminalTurnState(input.nextTurnState) ? defaultIdleActivity() : input.previousActivity;
}

function activeStreamingTailForGraphPatch(input: {
	readonly commandActiveStreamingTail: ActiveStreamingTail | null | undefined;
	readonly previousActiveStreamingTail: ActiveStreamingTail | null;
	readonly nextTurnState: SessionTurnState;
}): ActiveStreamingTail | null {
	if (input.commandActiveStreamingTail !== undefined) {
		return input.commandActiveStreamingTail;
	}

	return terminalTurnState(input.nextTurnState) ? null : input.previousActiveStreamingTail;
}

export function reduceCommand(
	snapshot: EnvelopeReducerSnapshot,
	command: SessionStateCommand,
	nowMs: number
): readonly EnvelopePatch[] {
	switch (command.kind) {
		case "applyCapabilities":
			return reduceApplyCapabilities(snapshot, command);
		case "applyTelemetry":
			return reduceApplyTelemetry(snapshot, command, nowMs);
		case "applyPlan":
			return reduceApplyPlan(snapshot, command);
		case "applyBufferPush":
			return [{ kind: "applyViewportBufferPush", push: command.push }];
		case "applyBufferDelta":
			return [{ kind: "applyViewportBufferDelta", delta: command.delta }];
		case "replaceGraph":
			return reduceReplaceGraph(snapshot, command);
		case "applyLifecycle":
			return reduceApplyLifecycle(snapshot, command, nowMs);
		case "applyGraphPatches":
			return reduceApplyGraphPatches(snapshot, command);
		case "applyTranscriptDelta":
			return reduceTranscriptDelta(snapshot, command.delta, command.revision);
		case "refreshSnapshot":
			return reduceRefreshSnapshot(snapshot, command);
		default:
			return [];
	}
}

function reduceApplyCapabilities(
	snapshot: EnvelopeReducerSnapshot,
	command: Extract<SessionStateCommand, { kind: "applyCapabilities" }>
): readonly EnvelopePatch[] {
	if (!snapshot.hasSessionIdentity) {
		return [];
	}

	if (isOlderGraphRevision(snapshot.previousProjection?.revision ?? null, command.revision)) {
		return [];
	}

	const canonicalCapabilities = sanitizeCanonicalCapabilities(command.capabilities);
	if (
		!isNewerGraphRevision(snapshot.previousProjection?.revision ?? null, command.revision) &&
		(snapshot.previousProjection === null ||
			capabilitiesEqual(snapshot.previousProjection.capabilities, canonicalCapabilities))
	) {
		return [];
	}

	const patches: EnvelopePatch[] = [
		{
			kind: "setCapabilitiesMaterialized",
			sessionId: snapshot.sessionId,
			materialized: true,
		},
	];

	if (snapshot.previousProjection !== null) {
		patches.push({
			kind: "setCanonicalProjection",
			sessionId: snapshot.sessionId,
			projection: {
				lifecycle: snapshot.previousProjection.lifecycle,
				activity: snapshot.previousProjection.activity,
				turnState: snapshot.previousProjection.turnState,
				activeTurnFailure: snapshot.previousProjection.activeTurnFailure,
				lastTerminalTurnId: snapshot.previousProjection.lastTerminalTurnId,
				activeStreamingTail: snapshot.previousProjection.activeStreamingTail,
				capabilities: canonicalCapabilities,
				revision: command.revision,
			},
		});
	}

	if (snapshot.previousGraph !== null) {
		patches.push({
			kind: "setSessionStateGraph",
			sessionId: snapshot.sessionId,
			graph: graphWithCapabilities(snapshot.previousGraph, canonicalCapabilities, command.revision),
		});
	}

	const transientUpdates: {
		capabilityMutationState?: SessionTransientProjection["capabilityMutationState"];
		autonomousTransition?: SessionTransientProjection["autonomousTransition"];
	} = {
		capabilityMutationState: {
			pendingMutationId: command.pendingMutationId,
			previewState: command.previewState,
		},
	};
	if (snapshot.transientProjection.autonomousTransition !== "idle") {
		transientUpdates.autonomousTransition = "idle";
	}
	patches.push({
		kind: "updateTransientProjection",
		sessionId: snapshot.sessionId,
		updates: transientUpdates,
	});

	return patches;
}

function reduceApplyTelemetry(
	snapshot: EnvelopeReducerSnapshot,
	command: Extract<SessionStateCommand, { kind: "applyTelemetry" }>,
	nowMs: number
): readonly EnvelopePatch[] {
	if (command.telemetry.parentToolUseId != null) {
		return [];
	}
	if (!isNewerGraphRevision(snapshot.previousProjection?.revision ?? null, command.revision)) {
		return [];
	}

	const nextTelemetry = buildCanonicalUsageTelemetry(
		command.telemetry,
		snapshot.transientProjection.usageTelemetry,
		snapshot.currentModelId,
		nowMs
	);
	if (nextTelemetry === null) {
		return [];
	}

	return [
		{
			kind: "setUsageTelemetry",
			sessionId: snapshot.sessionId,
			telemetry: nextTelemetry,
		},
	];
}

function reduceApplyPlan(
	snapshot: EnvelopeReducerSnapshot,
	command: Extract<SessionStateCommand, { kind: "applyPlan" }>
): readonly EnvelopePatch[] {
	if (!isNewerGraphRevision(snapshot.previousProjection?.revision ?? null, command.revision)) {
		return [];
	}

	return [
		{
			kind: "notifyPlanUpdate",
			sessionId: snapshot.sessionId,
			plan: command.plan,
		},
	];
}

function reduceReplaceGraph(
	snapshot: EnvelopeReducerSnapshot,
	command: Extract<SessionStateCommand, { kind: "replaceGraph" }>
): readonly EnvelopePatch[] {
	const graph = command.graph;
	const previousGraph = snapshot.previousGraph;
	const previousProjection = snapshot.previousProjection;
	const currentRevision = previousProjection?.revision ?? previousGraph?.revision ?? null;
	const currentLifecycleStatus =
		previousProjection?.lifecycle.status ?? previousGraph?.lifecycle.status ?? null;
	const isReadySnapshotRecovery =
		graph.lifecycle.status === "ready" &&
		(currentLifecycleStatus === "reserved" ||
			currentLifecycleStatus === "activating" ||
			currentLifecycleStatus === "reconnecting");
	if (!isNewerGraphRevision(currentRevision, graph.revision) && !isReadySnapshotRecovery) {
		return [];
	}

	const currentTranscriptRevision = previousGraph?.transcriptSnapshot.revision;
	const incomingTranscriptRevision = graph.transcriptSnapshot.revision;
	const shouldReplaceTranscriptSnapshot =
		currentTranscriptRevision === undefined ||
		incomingTranscriptRevision > currentTranscriptRevision;
	const operationGraph = graph;
	const patches: EnvelopePatch[] = [
		{
			kind: "replaceSessionOperations",
			sessionId: snapshot.sessionId,
			operations: operationGraph.operations,
		},
	];

	if (shouldReplaceTranscriptSnapshot) {
		patches.push({
			kind: "replaceTranscriptSnapshot",
			sessionId: snapshot.sessionId,
			snapshot: operationGraph.transcriptSnapshot,
			appliedAtMs: Date.now(),
		});
	}

	const projectionGraph = buildReplaceGraphProjection(
		operationGraph,
		previousGraph,
		shouldReplaceTranscriptSnapshot,
		currentTranscriptRevision
	);
	patches.push(
		{ kind: "replaceLiveSessionStateGraph", graph: projectionGraph },
		{ kind: "applySessionStateGraph", graph: projectionGraph },
		{
			kind: "syncAwaitingModelRefreshTimer",
			sessionId: snapshot.sessionId,
			activity: projectionGraph.activity,
			turnState: projectionGraph.turnState,
		}
	);

	return patches;
}

function buildReplaceGraphProjection(
	operationGraph: SessionStateGraph,
	previousGraph: SessionStateGraph | null,
	shouldReplaceTranscriptSnapshot: boolean,
	currentTranscriptRevision: number | undefined
): SessionStateGraph {
	if (
		shouldReplaceTranscriptSnapshot ||
		currentTranscriptRevision === undefined ||
		previousGraph === null
	) {
		if (previousGraph === null) {
			return {
				requestedSessionId: operationGraph.requestedSessionId,
				canonicalSessionId: operationGraph.canonicalSessionId,
				isAlias: operationGraph.isAlias,
				agentId: operationGraph.agentId,
				projectPath: operationGraph.projectPath,
				worktreePath: operationGraph.worktreePath ?? null,
				sourcePath: operationGraph.sourcePath ?? null,
				revision: operationGraph.revision,
				transcriptSnapshot: operationGraph.transcriptSnapshot,
				operations: operationGraph.operations,
				interactions: operationGraph.interactions,
				turnState: operationGraph.turnState,
				messageCount: operationGraph.messageCount,
				activeStreamingTail: operationGraph.activeStreamingTail ?? null,
				activeTurnFailure: operationGraph.activeTurnFailure ?? null,
				lastTerminalTurnId: operationGraph.lastTerminalTurnId ?? null,
				lifecycle: operationGraph.lifecycle,
				activity: seedSessionGraphActivityTimingIfNeeded(operationGraph.activity, Date.now()),
				capabilities: operationGraph.capabilities,
			};
		}

		return {
			requestedSessionId: operationGraph.requestedSessionId,
			canonicalSessionId: operationGraph.canonicalSessionId,
			isAlias: operationGraph.isAlias,
			agentId: operationGraph.agentId,
			projectPath: operationGraph.projectPath,
			worktreePath: operationGraph.worktreePath ?? null,
			sourcePath: operationGraph.sourcePath ?? null,
			revision: operationGraph.revision,
			transcriptSnapshot: operationGraph.transcriptSnapshot,
			operations: operationGraph.operations,
			interactions: operationGraph.interactions,
			turnState: operationGraph.turnState,
			messageCount: operationGraph.messageCount,
			activeStreamingTail: operationGraph.activeStreamingTail ?? null,
			activeTurnFailure: operationGraph.activeTurnFailure ?? null,
			lastTerminalTurnId: operationGraph.lastTerminalTurnId ?? null,
			lifecycle: operationGraph.lifecycle,
			activity: mergeSessionGraphActivityTiming(
				previousGraph.activity,
				operationGraph.activity,
				Date.now()
			),
			capabilities: operationGraph.capabilities,
		};
	}

	return graphWithTranscriptSnapshot(operationGraph, previousGraph.transcriptSnapshot);
}

function reduceApplyLifecycle(
	snapshot: EnvelopeReducerSnapshot,
	command: Extract<SessionStateCommand, { kind: "applyLifecycle" }>,
	nowMs: number
): readonly EnvelopePatch[] {
	const transientProjection = snapshot.transientProjection;
	const previousProjection = snapshot.previousProjection;
	const previousGraph = snapshot.previousGraph;
	const lifecycleRevision = command.revision;

	if (!isNewerGraphRevision(previousProjection?.revision ?? null, lifecycleRevision)) {
		return [];
	}

	const turnState = previousProjection?.turnState ?? "Idle";
	const activeTurnFailure = previousProjection?.activeTurnFailure ?? null;
	const graphActiveTurnFailure = previousGraph?.activeTurnFailure ?? null;
	const reconciledActivity =
		reconcileStoredGraphActivity(
			previousProjection?.activity ?? null,
			command.lifecycle,
			turnState,
			activeTurnFailure
		) ?? defaultIdleActivity();

	const patches: EnvelopePatch[] = [
		{
			kind: "setCanonicalProjection",
			sessionId: snapshot.sessionId,
			projection: {
				lifecycle: command.lifecycle,
				activity: reconciledActivity,
				turnState,
				activeTurnFailure,
				lastTerminalTurnId: previousProjection?.lastTerminalTurnId ?? null,
				activeStreamingTail: previousProjection?.activeStreamingTail ?? null,
				capabilities: previousProjection?.capabilities ?? emptySessionGraphCapabilities(),
				revision: lifecycleRevision,
			},
		},
		{
			kind: "setCapabilitiesMaterialized",
			sessionId: snapshot.sessionId,
			materialized: snapshot.capabilitiesMaterialized,
		},
	];

	if (previousGraph !== null) {
		patches.push({
			kind: "setSessionStateGraph",
			sessionId: snapshot.sessionId,
			graph: graphWithLifecycle(
				previousGraph,
				command.lifecycle,
				mergeSessionGraphActivityTiming(previousGraph.activity, reconciledActivity, nowMs),
				lifecycleRevision
			),
		});
	} else {
		patches.push({
			kind: "setSessionStateGraph",
			sessionId: snapshot.sessionId,
			graph: createLifecycleOnlyGraph({
				sessionId: snapshot.sessionId,
				session: snapshot.sessionCold,
				lifecycle: command.lifecycle,
				activity: reconciledActivity,
				turnState,
				activeTurnFailure: graphActiveTurnFailure,
				lastTerminalTurnId: previousProjection?.lastTerminalTurnId ?? null,
				capabilities: previousProjection?.capabilities ?? emptySessionGraphCapabilities(),
				revision: lifecycleRevision,
			}),
		});
	}

	const transientUpdates: {
		acpSessionId?: SessionTransientProjection["acpSessionId"];
		statusChangedAt?: number;
	} = {
		acpSessionId:
			command.lifecycle.status === "ready" ? snapshot.sessionId : transientProjection.acpSessionId,
	};
	if (previousProjection?.lifecycle.status !== command.lifecycle.status) {
		transientUpdates.statusChangedAt = nowMs;
	}
	patches.push({
		kind: "updateTransientProjection",
		sessionId: snapshot.sessionId,
		updates: transientUpdates,
	});
	patches.push(
		{
			kind: "reconcileConnectionMachine",
			sessionId: snapshot.sessionId,
			lifecycle: command.lifecycle,
			turnState,
			activeTurnFailure,
		},
		{
			kind: "syncAwaitingModelRefreshTimer",
			sessionId: snapshot.sessionId,
			activity: reconciledActivity,
			turnState,
		}
	);

	return patches;
}

function reduceApplyGraphPatches(
	snapshot: EnvelopeReducerSnapshot,
	command: Extract<SessionStateCommand, { kind: "applyGraphPatches" }>
): readonly EnvelopePatch[] {
	const previousProjection = snapshot.previousProjection;
	if (previousProjection === null) {
		return [
			{
				kind: "warnMissingCanonicalProjection",
				sessionId: snapshot.sessionId,
				reason: "graphPatches",
				context: { revision: command.revision },
			},
			{
				kind: "refreshSessionStateSnapshot",
				sessionId: snapshot.sessionId,
				reason: "missingCanonicalProjection",
			},
		];
	}

	if (!isNewerGraphRevision(previousProjection.revision, command.revision)) {
		return [];
	}

	const previousGraph = snapshot.previousGraph;
	const activeTurnFailure =
		command.activeTurnFailure === undefined
			? previousProjection.activeTurnFailure
			: mapProjectionTurnFailure(command.activeTurnFailure);
	const nextTurnState = command.turnState ?? previousProjection.turnState;
	const nextProjectionActivity = activityForGraphPatch({
		commandActivity: command.activity,
		previousActivity: previousProjection.activity,
		nextTurnState,
	});
	const nextLastTerminalTurnId =
		command.lastTerminalTurnId === undefined
			? previousProjection.lastTerminalTurnId
			: command.lastTerminalTurnId;
	const nextProjectionActiveStreamingTail = activeStreamingTailForGraphPatch({
		commandActiveStreamingTail: command.activeStreamingTail,
		previousActiveStreamingTail: previousProjection.activeStreamingTail,
		nextTurnState,
	});

	const patches: EnvelopePatch[] = [
		{
			kind: "applySessionOperationPatches",
			sessionId: snapshot.sessionId,
			patches: command.operationPatches,
		},
		{
			kind: "applyLiveSessionInteractionPatches",
			snapshots: command.interactionPatches,
		},
	];

	if (previousGraph === null) {
		return [
			...patches,
			{
				kind: "warnMissingCanonicalProjection",
				sessionId: snapshot.sessionId,
				reason: "graphPatches",
				context: { revision: command.revision },
			},
			{
				kind: "refreshSessionStateSnapshot",
				sessionId: snapshot.sessionId,
				reason: "missingCanonicalGraph",
			},
		];
	}
	const nextGraphActivity = activityForGraphPatch({
		commandActivity: command.activity,
		previousActivity: previousGraph.activity,
		nextTurnState,
	});
	const nextGraphActiveStreamingTail = activeStreamingTailForGraphPatch({
		commandActiveStreamingTail: command.activeStreamingTail,
		previousActiveStreamingTail: previousGraph.activeStreamingTail,
		nextTurnState,
	});

	patches.push({
		kind: "setSessionStateGraph",
		sessionId: snapshot.sessionId,
		graph: graphWithPatches({
			graph: previousGraph,
			revision: command.revision,
			activity: nextGraphActivity,
			turnState: command.turnState,
			activeTurnFailure: command.activeTurnFailure,
			lastTerminalTurnId: command.lastTerminalTurnId,
			activeStreamingTail: nextGraphActiveStreamingTail,
			operationPatches: command.operationPatches,
			interactionPatches: command.interactionPatches,
		}),
	});

	patches.push({
		kind: "setCanonicalProjection",
		sessionId: snapshot.sessionId,
		projection: {
			lifecycle: previousProjection.lifecycle,
			activity: nextProjectionActivity,
			turnState: nextTurnState,
			activeTurnFailure,
			lastTerminalTurnId: nextLastTerminalTurnId,
			activeStreamingTail: nextProjectionActiveStreamingTail,
			capabilities: previousProjection.capabilities,
			revision: command.revision,
		},
	});

	patches.push(
		{
			kind: "invokeCanonicalTerminalTurnSideEffects",
			sessionId: snapshot.sessionId,
			previousProjection,
			turnState: nextTurnState,
			activeTurnFailure,
			projectedFailure: command.activeTurnFailure ?? null,
			lastTerminalTurnId: nextLastTerminalTurnId,
		},
		{
			kind: "reconcileConnectionMachine",
			sessionId: snapshot.sessionId,
			lifecycle: previousProjection.lifecycle,
			turnState: nextTurnState,
			activeTurnFailure,
		},
		{
			kind: "syncAwaitingModelRefreshTimer",
			sessionId: snapshot.sessionId,
			activity: nextProjectionActivity,
			turnState: nextTurnState,
		}
	);

	return patches;
}

export function reduceTranscriptDelta(
	snapshot: EnvelopeReducerSnapshot,
	delta: TranscriptDelta,
	revision?: SessionGraphRevision
): readonly EnvelopePatch[] {
	const currentTranscriptRevision = snapshot.previousGraph?.transcriptSnapshot.revision;
	const patches: EnvelopePatch[] = [
		{
			kind: "applyTranscriptDeltaToEntryStore",
			sessionId: snapshot.sessionId,
			delta,
			appliedAtMs: Date.now(),
		},
	];

	let nextSnapshot: TranscriptSnapshot | null = null;
	if (
		currentTranscriptRevision === undefined ||
		delta.snapshotRevision > currentTranscriptRevision
	) {
		const previousGraph = snapshot.previousGraph;
		if (previousGraph !== null) {
			nextSnapshot = applyTranscriptDeltaToSnapshot(previousGraph.transcriptSnapshot, delta);
			patches.unshift({
				kind: "setSessionStateGraph",
				sessionId: snapshot.sessionId,
				graph: graphWithTranscriptSnapshot(previousGraph, nextSnapshot, revision),
			});
		}
	}

	return patches;
}

function reduceRefreshSnapshot(
	snapshot: EnvelopeReducerSnapshot,
	command: Extract<SessionStateCommand, { kind: "refreshSnapshot" }>
): readonly EnvelopePatch[] {
	const currentTranscriptRevision = snapshot.previousGraph?.transcriptSnapshot.revision;
	return [
		{
			kind: "refreshSessionStateSnapshot",
			sessionId: snapshot.sessionId,
			reason: "transcriptFrontierMismatch",
			warnContext: {
				currentTranscriptRevision,
				fromRevision: command.fromRevision,
				toRevision: command.toRevision,
			},
		},
	];
}

function capabilitiesEqual(
	left: SessionGraphCapabilities,
	right: SessionGraphCapabilities
): boolean {
	const sanitizedLeft = sanitizeCanonicalCapabilities(left);
	const sanitizedRight = sanitizeCanonicalCapabilities(right);
	return JSON.stringify(sanitizedLeft) === JSON.stringify(sanitizedRight);
}
