import type {
	ActiveStreamingTail,
	SessionGraphActivity,
	SessionGraphCapabilities,
	SessionGraphRevision,
	SessionStateGraph,
	SessionTurnState,
	TranscriptDelta,
	TranscriptEntry,
	TranscriptSnapshot,
} from "../../../services/acp-types.js";
import type { SessionStateCommand } from "../../session-state/session-state-command-router.js";
import { projectionWithCapabilities } from "../canonical-session-projection.js";
import {
	graphWithCapabilities,
	graphWithLifecycle,
	graphWithPatches,
	graphWithTranscriptSnapshot,
} from "../session-graph-builders.js";
import { applyTranscriptDeltaToSnapshot } from "../transcript-delta.js";
import type { SessionTransientProjection } from "../types.js";
import { buildCanonicalUsageTelemetry } from "./canonical-usage-telemetry.js";
import { capabilitiesWithSessionMode } from "./capabilities-with-session-mode.js";
import {
	capabilitiesWithSessionModel,
	capabilitiesWithSessionModels,
} from "./capabilities-with-session-models.js";
import { emptySessionGraphCapabilities } from "./empty-session-graph-capabilities.js";
import type { EnvelopePatch } from "./envelope-patch.js";
import type { EnvelopeReducerSnapshot } from "./envelope-snapshot.js";
import { isNewerGraphRevision, isOlderGraphRevision } from "./graph-revision-order.js";
import { createLifecycleOnlyGraph } from "./lifecycle-only-graph.js";
import {
	mergeSessionGraphActivityTiming,
	seedSessionGraphActivityTimingIfNeeded,
} from "./merge-session-graph-activity-timing.js";
import { acknowledgedPendingSendAttemptId } from "./pending-send-acknowledgement.js";
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

/**
 * The patch that retires a local optimistic send the canonical transcript has
 * just acknowledged. Empty when nothing in this transcript matches the pending
 * intent, so a session with no pending send costs one null check.
 */
function pendingSendAcknowledgementPatches(input: {
	readonly snapshot: EnvelopeReducerSnapshot;
	readonly entries: readonly TranscriptEntry[];
	readonly previousEntries: readonly TranscriptEntry[];
	readonly transcriptRevision: number;
}): readonly EnvelopePatch[] {
	const attemptId = acknowledgedPendingSendAttemptId({
		pendingSendIntent: input.snapshot.transientProjection.pendingSendIntent,
		entries: input.entries,
		previousEntries: input.previousEntries,
		transcriptRevision: input.transcriptRevision,
	});
	if (attemptId === null) {
		return [];
	}

	return [
		{
			kind: "clearAcknowledgedPendingSendIntent",
			sessionId: input.snapshot.sessionId,
			attemptId,
		},
	];
}

export function reduceCommand(
	snapshot: EnvelopeReducerSnapshot,
	command: SessionStateCommand,
	nowMs: number
): readonly EnvelopePatch[] {
	switch (command.kind) {
		case "applySessionMode":
			return reduceApplySessionMode(snapshot, command);
		case "applySessionModel":
			return reduceApplySessionModel(snapshot, command);
		case "applySessionModels":
			return reduceApplySessionModels(snapshot, command);
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
		case "applyPreBaselineTurnFailure":
			return reducePreBaselineTurnFailure(snapshot, command);
		default:
			return [];
	}
}

/**
 * #283: the live path for the canonical current mode.
 *
 * Every other capability reaches the store as a whole projection, on the graph
 * a snapshot envelope carries, which SessionEnvelopeApplier sanitizes and
 * writes in one go. A mode change is one field, so it patches: everything else
 * on the capabilities stays as it was (see `capabilitiesWithSessionMode`). An
 * older revision cannot overwrite a newer mode, and an equal revision applies
 * only when the mode actually differs.
 *
 * `capabilitiesMaterialized` is deliberately untouched. A mode alone does not
 * materialize a session's capability set, and claiming it did would make the
 * composer read canonical models and commands that no producer has filled in
 * yet.
 */
function reduceApplySessionMode(
	snapshot: EnvelopeReducerSnapshot,
	command: Extract<SessionStateCommand, { kind: "applySessionMode" }>
): readonly EnvelopePatch[] {
	return patchCapabilities({
		snapshot,
		revision: command.revision,
		alreadyApplied: (previous) => previous.modes?.currentModeId === command.currentModeId,
		fold: (previous) => capabilitiesWithSessionMode(previous, command.currentModeId),
	});
}

/**
 * The capabilities patches every single-fact writer above and below produces.
 * They differ only in how they fold the new fact into the previous
 * capabilities, so the guards -- a session identity, a capabilities projection
 * to patch, a revision that is not older than the one already applied, and a
 * fact the projection already carries at this revision -- live here once.
 */
function patchCapabilities(input: {
	readonly snapshot: EnvelopeReducerSnapshot;
	readonly revision: SessionGraphRevision;
	readonly fold: (previous: SessionGraphCapabilities) => SessionGraphCapabilities;
	/**
	 * True when the previous capabilities already carry this exact fact. It
	 * skips the write only for a revision that is not newer, so a re-delivered
	 * envelope costs nothing while a genuine revision bump still advances the
	 * projection.
	 */
	readonly alreadyApplied?: (previous: SessionGraphCapabilities) => boolean;
}): readonly EnvelopePatch[] {
	const snapshot = input.snapshot;
	if (!snapshot.hasSessionIdentity) {
		return [];
	}

	const previousProjection = snapshot.previousProjection;
	const previousGraph = snapshot.previousGraph;
	const previousCapabilities =
		previousProjection?.capabilities ?? previousGraph?.capabilities ?? null;
	if (previousCapabilities === null) {
		return [];
	}

	const previousRevision = previousProjection?.revision ?? null;
	if (isOlderGraphRevision(previousRevision, input.revision)) {
		return [];
	}

	if (
		input.alreadyApplied?.(previousCapabilities) === true &&
		!isNewerGraphRevision(previousRevision, input.revision)
	) {
		return [];
	}

	const nextCapabilities = input.fold(previousCapabilities);
	const patches: EnvelopePatch[] = [];

	if (previousProjection !== null) {
		patches.push({
			kind: "setCanonicalProjection",
			sessionId: snapshot.sessionId,
			projection: projectionWithCapabilities(previousProjection, nextCapabilities, input.revision),
		});
	}

	if (previousGraph !== null) {
		patches.push({
			kind: "setSessionStateGraph",
			sessionId: snapshot.sessionId,
			graph: graphWithCapabilities(previousGraph, nextCapabilities, input.revision),
		});
	}

	return patches;
}

/**
 * The live path for the canonical chosen model, the model counterpart of
 * reduceApplySessionMode above. Until this existed, a chosen model reached
 * nothing: the composer showed it from its own optimistic state while the
 * canonical projection kept the previous one.
 *
 * `capabilitiesMaterialized` stays untouched for the same reason it does for a
 * mode: one field is not a materialized capability set.
 */
function reduceApplySessionModel(
	snapshot: EnvelopeReducerSnapshot,
	command: Extract<SessionStateCommand, { kind: "applySessionModel" }>
): readonly EnvelopePatch[] {
	return patchCapabilities({
		snapshot,
		revision: command.revision,
		alreadyApplied: (previous) => previous.models?.currentModelId === command.currentModelId,
		fold: (previous) => capabilitiesWithSessionModel(previous, command.currentModelId),
	});
}

/**
 * The live path for a provider's own model catalog. The picker used to read a
 * hand-written list of five models seeded at session open, so a model the
 * provider shipped later did not exist to the app at all.
 *
 * No `alreadyApplied` here: a provider answers once per session, so comparing
 * two catalogs element by element would buy nothing.
 */
function reduceApplySessionModels(
	snapshot: EnvelopeReducerSnapshot,
	command: Extract<SessionStateCommand, { kind: "applySessionModels" }>
): readonly EnvelopePatch[] {
	return patchCapabilities({
		snapshot,
		revision: command.revision,
		fold: (previous) => capabilitiesWithSessionModels(previous, command.availableModels),
	});
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

	patches.push(
		...pendingSendAcknowledgementPatches({
			snapshot,
			entries: projectionGraph.transcriptSnapshot.entries,
			previousEntries: previousGraph?.transcriptSnapshot.entries ?? [],
			transcriptRevision: projectionGraph.transcriptSnapshot.revision,
		})
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

	// A delta can only acknowledge what it carries. An acknowledgement already
	// in the previous snapshot was applied when that snapshot arrived, so
	// re-reading the folded snapshot here would buy nothing.
	patches.push(
		...pendingSendAcknowledgementPatches({
			snapshot,
			entries: transcriptDeltaEntries(delta),
			previousEntries: snapshot.previousGraph?.transcriptSnapshot.entries ?? [],
			transcriptRevision: delta.snapshotRevision,
		})
	);

	return patches;
}

/**
 * The entries a delta carries. Only appended entries and whole-snapshot
 * replacements name an entry; a segment append extends an entry that already
 * exists.
 */
function transcriptDeltaEntries(delta: TranscriptDelta): readonly TranscriptEntry[] {
	const entries: TranscriptEntry[] = [];
	for (const operation of delta.operations) {
		if (operation.kind === "appendEntry") {
			entries.push(operation.entry);
			continue;
		}
		if (operation.kind === "replaceSnapshot") {
			entries.push(...operation.snapshot.entries);
		}
	}
	return entries;
}

/**
 * A turn failed for a session with no canonical graph behind it.
 *
 * When the store is still holding an optimistic row for a creation the backend
 * never confirmed, that failure is the creation dying: the row has nothing
 * canonical behind it and must go, or it lingers as a phantom thread. Any other
 * session missing its graph is a gap in what the store holds, so it refetches.
 */
function reducePreBaselineTurnFailure(
	snapshot: EnvelopeReducerSnapshot,
	command: Extract<SessionStateCommand, { kind: "applyPreBaselineTurnFailure" }>
): readonly EnvelopePatch[] {
	if (snapshot.hasPendingCreation) {
		return [
			{
				kind: "abandonPendingCreationSession",
				sessionId: snapshot.sessionId,
				failure: command.failure,
			},
		];
	}

	return [
		{
			kind: "refreshSessionStateSnapshot",
			sessionId: snapshot.sessionId,
			reason: "missingCanonicalGraph",
			warnContext: {
				currentTranscriptRevision: snapshot.previousGraph?.transcriptSnapshot.revision,
				fromRevision: command.fromRevision,
				toRevision: command.toRevision,
			},
		},
	];
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
