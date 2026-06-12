import type {
	SessionGraphRevision,
	SessionStateGraph,
	TranscriptDelta,
	TranscriptSnapshot,
} from "../../../services/acp-types.js";
import type { SessionStateCommand } from "../../session-state/session-state-command-router.js";
import { sanitizeCanonicalCapabilities } from "../canonical-config-sanitize.js";
import type { SessionClockAnchor } from "../canonical-session-projection.js";
import type { RowTokenStream } from "../canonical-session-projection.js";
import { graphWithCapabilities } from "../session-graph-builders.js";
import {
	graphWithLifecycle,
	graphWithPatches,
	graphWithTranscriptSnapshot,
} from "../session-graph-builders.js";
import type { SessionTransientProjection } from "../types.js";
import {
	applyTranscriptDeltaToSnapshot,
	buildRowTokenStreamKey,
	cloneRowTokenStreamMap,
	countAppendedMarkdownWords,
} from "../transcript-delta.js";
import { buildCanonicalUsageTelemetry } from "./canonical-usage-telemetry.js";
import { preserveCanonicalStreamingState } from "./canonical-streaming-state.js";
import { emptySessionGraphCapabilities } from "./empty-session-graph-capabilities.js";
import type { EnvelopePatch } from "./envelope-patch.js";
import type { EnvelopeReducerSnapshot } from "./envelope-snapshot.js";
import { isNewerGraphRevision } from "./graph-revision-order.js";
import { createLifecycleOnlyGraph } from "./lifecycle-only-graph.js";
import { pendingSendIntentClearUpdate } from "./pending-send-acknowledgement.js";
import { mapProjectionTurnFailure } from "./projection-turn-failure.js";
import {
	defaultIdleActivity,
	reconcileStoredGraphActivity,
} from "./reconcile-graph-activity.js";

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
		case "applyAssistantTextDelta":
			return reduceApplyAssistantTextDelta(snapshot, command);
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

	if (!isNewerGraphRevision(snapshot.previousProjection?.revision ?? null, command.revision)) {
		return [];
	}

	const preservedStreamingState = preserveCanonicalStreamingState(snapshot.previousProjection);
	const canonicalCapabilities = sanitizeCanonicalCapabilities(command.capabilities);
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
				tokenStream: preservedStreamingState.tokenStream,
				clockAnchor: preservedStreamingState.clockAnchor,
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
		return operationGraph;
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

	const preservedStreamingState = preserveCanonicalStreamingState(previousProjection);
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
				tokenStream: preservedStreamingState.tokenStream,
				clockAnchor: preservedStreamingState.clockAnchor,
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
				reconciledActivity,
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
		pendingSendIntent?: null;
	} = {
		acpSessionId:
			command.lifecycle.status === "ready" ? snapshot.sessionId : transientProjection.acpSessionId,
	};
	if (previousProjection?.lifecycle.status !== command.lifecycle.status) {
		transientUpdates.statusChangedAt = nowMs;
	}
	const pendingClear =
		previousGraph !== null
			? pendingSendIntentClearUpdate(
					previousGraph.transcriptSnapshot,
					transientProjection.pendingSendIntent
				)
			: null;
	if (pendingClear !== null) {
		transientUpdates.pendingSendIntent = pendingClear.pendingSendIntent;
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

	const preservedStreamingState = preserveCanonicalStreamingState(previousProjection);
	const previousGraph = snapshot.previousGraph;
	const activeTurnFailure =
		command.activeTurnFailure === undefined
			? previousProjection.activeTurnFailure
			: mapProjectionTurnFailure(command.activeTurnFailure);
	const nextActivity = command.activity ?? previousProjection.activity;
	const nextTurnState = command.turnState ?? previousProjection.turnState;
	const nextLastTerminalTurnId =
		command.lastTerminalTurnId === undefined
			? previousProjection.lastTerminalTurnId
			: command.lastTerminalTurnId;

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

	patches.push({
		kind: "setSessionStateGraph",
		sessionId: snapshot.sessionId,
		graph: graphWithPatches({
			graph: previousGraph,
			revision: command.revision,
			activity: command.activity,
			turnState: command.turnState,
			activeTurnFailure: command.activeTurnFailure,
			lastTerminalTurnId: command.lastTerminalTurnId,
			activeStreamingTail: command.activeStreamingTail,
			operationPatches: command.operationPatches,
			interactionPatches: command.interactionPatches,
		}),
	});

	patches.push({
		kind: "setCanonicalProjection",
		sessionId: snapshot.sessionId,
		projection: {
			lifecycle: previousProjection.lifecycle,
			activity: nextActivity,
			turnState: nextTurnState,
			activeTurnFailure,
			lastTerminalTurnId: nextLastTerminalTurnId,
			activeStreamingTail:
				command.activeStreamingTail === undefined
					? previousProjection.activeStreamingTail
					: command.activeStreamingTail,
			capabilities: previousProjection.capabilities,
			tokenStream: preservedStreamingState.tokenStream,
			clockAnchor: preservedStreamingState.clockAnchor,
			revision: command.revision,
		},
	});

	const pendingClear = pendingSendIntentClearUpdate(
		previousGraph.transcriptSnapshot,
		snapshot.transientProjection.pendingSendIntent
	);
	if (pendingClear !== null) {
		patches.push({
			kind: "updateTransientProjection",
			sessionId: snapshot.sessionId,
			updates: { pendingSendIntent: pendingClear.pendingSendIntent },
		});
	}

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
			activity: nextActivity,
			turnState: nextTurnState,
		}
	);

	return patches;
}

function reduceApplyAssistantTextDelta(
	snapshot: EnvelopeReducerSnapshot,
	command: Extract<SessionStateCommand, { kind: "applyAssistantTextDelta" }>
): readonly EnvelopePatch[] {
	const delta = command.delta;
	const projection = snapshot.previousProjection;
	if (projection === null) {
		return [
			{
				kind: "warnMissingCanonicalProjection",
				sessionId: snapshot.sessionId,
				reason: "assistantTextDelta",
				context: {
					turnId: delta.turnId,
					rowId: delta.rowId,
					deltaRevision: delta.revision,
				},
			},
			{
				kind: "refreshSessionStateSnapshot",
				sessionId: snapshot.sessionId,
				reason: "missingProjectionBeforeAssistantDelta",
			},
		];
	}

	const rowKey = buildRowTokenStreamKey(delta.turnId, delta.rowId);
	const previousRow = projection.tokenStream.get(rowKey) ?? null;
	if (previousRow !== null && delta.revision < previousRow.revision) {
		return [];
	}
	if (delta.revision <= projection.revision.graphRevision) {
		return [];
	}

	const currentText = previousRow?.accumulatedText ?? "";
	if (delta.charOffset !== currentText.length) {
		return [];
	}

	const nextText = `${currentText}${delta.deltaText}`;
	const wordCounts = countAppendedMarkdownWords({
		previousText: currentText,
		previousWordCount: previousRow?.wordCount ?? 0,
		deltaText: delta.deltaText,
	});
	const nextRow: RowTokenStream = {
		turnId: delta.turnId,
		rowId: delta.rowId,
		accumulatedText: nextText,
		wordCount: wordCounts.wordCount,
		latestWordCount: wordCounts.latestWordCount,
		firstDeltaProducedAtMonotonicMs:
			previousRow?.firstDeltaProducedAtMonotonicMs ?? delta.producedAtMonotonicMs,
		lastDeltaProducedAtMonotonicMs: delta.producedAtMonotonicMs,
		revision: delta.revision,
	};
	const nextTokenStream = cloneRowTokenStreamMap(projection.tokenStream);
	nextTokenStream.set(rowKey, nextRow);
	const nextClockAnchor: SessionClockAnchor =
		projection.clockAnchor ??
		({
			rustMonotonicMs: delta.producedAtMonotonicMs,
			browserAnchorMs: snapshot.browserMonotonicMs,
		} satisfies SessionClockAnchor);

	return [
		{
			kind: "setCanonicalProjection",
			sessionId: snapshot.sessionId,
			projection: {
				lifecycle: projection.lifecycle,
				activity: projection.activity,
				turnState: projection.turnState,
				activeTurnFailure: projection.activeTurnFailure,
				lastTerminalTurnId: projection.lastTerminalTurnId,
				activeStreamingTail: projection.activeStreamingTail,
				capabilities: projection.capabilities,
				tokenStream: nextTokenStream,
				clockAnchor: nextClockAnchor,
				revision: projection.revision,
			},
		},
		{
			kind: "setRowTokenStream",
			sessionId: snapshot.sessionId,
			rowId: delta.rowId,
			row: nextRow,
		},
	];
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

	const pendingSendIntent = snapshot.transientProjection.pendingSendIntent ?? null;
	const pendingClear =
		nextSnapshot !== null && pendingSendIntent !== null
			? pendingSendIntentClearUpdate(nextSnapshot, pendingSendIntent)
			: null;
	if (pendingClear !== null) {
		patches.push({
			kind: "updateTransientProjection",
			sessionId: snapshot.sessionId,
			updates: { pendingSendIntent: pendingClear.pendingSendIntent },
		});
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
