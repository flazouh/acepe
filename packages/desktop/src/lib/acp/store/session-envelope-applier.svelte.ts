/**
 * SessionEnvelopeApplier — owns the canonical envelope apply spine of the session
 * store (see docs/adr/0002): assemble reducer snapshot → route → reduce → apply
 * patches, plus direct graph materialization (`applySessionStateGraph`).
 *
 * GOD note: this is the TypeScript write spine for Rust-owned SessionStateGraph
 * truth. Pure patch computation lives in `envelope-reducer/`; this class applies
 * patches to the existing sub-store owners without introducing dual-write or
 * `canonical ?? hot` fallback.
 */

import type { ResultAsync } from "neverthrow";
import type {
	InteractionSnapshot,
	OperationSnapshot,
	PlanData,
	SessionGraphActivity,
	SessionGraphLifecycle,
	SessionGraphRevision,
	SessionStateEnvelope,
	SessionStateGraph,
	SessionTurnState,
	TranscriptDelta,
	TranscriptSnapshot,
	TurnFailureSnapshot,
	ViewportBufferDelta,
	ViewportBufferPush,
} from "../../services/acp-types.js";
import type { AppError } from "../errors/app-error.js";
import type { SessionStateCommand } from "../session-state/session-state-command-router.js";
import { routeSessionStateEnvelope } from "../session-state/session-state-command-router.js";
import type { ActiveTurnFailure, TurnErrorUpdate } from "../types/turn-error.js";
import { createLogger } from "../utils/logger.js";
import { sanitizeCanonicalCapabilities } from "./canonical-config-sanitize.js";
import type { CanonicalSessionProjection } from "./canonical-session-projection.js";
import { deriveCapabilityPreviewState } from "./capability-projection.js";
import type { EnvelopePatch } from "./envelope-reducer/envelope-patch.js";
import type { EnvelopeReducerSnapshot } from "./envelope-reducer/envelope-snapshot.js";
import {
	isNewerGraphRevision,
	isOlderGraphRevision,
} from "./envelope-reducer/graph-revision-order.js";
import { mapProjectionTurnFailure } from "./envelope-reducer/projection-turn-failure.js";
import { reduceCommand, reduceTranscriptDelta } from "./envelope-reducer/reduce-command.js";
import { seedTranscriptEntryIndex } from "./transcript-entry-index.js";
import type {
	SessionCold,
	SessionIdentity,
	SessionTransientProjection,
	SessionUsageTelemetry,
} from "./types.js";

const logger = createLogger({ id: "session-envelope-applier", name: "SessionEnvelopeApplier" });

type SessionTransientProjectionUpdates = {
	-readonly [K in keyof SessionTransientProjection]?: SessionTransientProjection[K];
};

type InflightSessionStateRefresh = ResultAsync<void, AppError>;

export type SessionEnvelopeApplierCallbacks = {
	readonly onPlanUpdate?: (sessionId: string, plan: PlanData) => void;
	readonly onTurnComplete?: (sessionId: string) => void;
	readonly onTurnError?: (sessionId: string) => void;
};

export type SessionEnvelopeApplierDeps = {
	readonly getCallbacks: () => SessionEnvelopeApplierCallbacks;
	readonly getSessionIdentity: (sessionId: string) => SessionIdentity | undefined;
	readonly getGraphRevision: (sessionId: string) => SessionGraphRevision | undefined;
	readonly getCanonicalProjection: (sessionId: string) => CanonicalSessionProjection | null;
	readonly getSessionStateGraph: (sessionId: string) => SessionStateGraph | null;
	readonly getCapabilitiesMaterialized: (sessionId: string) => boolean;
	readonly getTransientProjection: (sessionId: string) => SessionTransientProjection;
	readonly getSessionCurrentModelId: (sessionId: string) => string | null;
	readonly getSessionCold: (sessionId: string) => SessionCold | undefined;
	readonly setCapabilitiesMaterialized: (sessionId: string, materialized: boolean) => void;
	readonly setCanonicalProjection: (
		sessionId: string,
		projection: CanonicalSessionProjection
	) => void;
	readonly setSessionStateGraph: (sessionId: string, graph: SessionStateGraph) => void;
	readonly updateTransientProjection: (
		sessionId: string,
		updates: SessionTransientProjectionUpdates
	) => void;
	readonly updateUsageTelemetry: (sessionId: string, telemetry: SessionUsageTelemetry) => void;
	readonly applyViewportBufferPush: (push: ViewportBufferPush) => void;
	readonly applyViewportBufferDelta: (delta: ViewportBufferDelta) => void;
	readonly replaceSessionOperations: (sessionId: string, operations: OperationSnapshot[]) => void;
	readonly replaceTranscriptSnapshot: (
		sessionId: string,
		snapshot: TranscriptSnapshot,
		appliedAt: Date
	) => void;
	readonly applyTranscriptDeltaToEntryStore: (
		sessionId: string,
		delta: TranscriptDelta,
		appliedAt: Date
	) => void;
	readonly applySessionOperationPatches: (
		sessionId: string,
		patches: ReadonlyArray<OperationSnapshot>
	) => void;
	readonly replaceLiveSessionStateGraph: (graph: SessionStateGraph) => void;
	readonly applyLiveSessionInteractionPatches: (
		snapshots: ReadonlyArray<InteractionSnapshot>
	) => void;
	readonly syncAwaitingModelRefreshTimer: (
		sessionId: string,
		activity: SessionGraphActivity,
		turnState: SessionTurnState
	) => void;
	readonly reconcileConnectionMachine: (
		sessionId: string,
		lifecycle: SessionGraphLifecycle,
		turnState: SessionTurnState,
		activeTurnFailure: ActiveTurnFailure | null
	) => void;
	readonly syncSessionSequenceFromGraph: (graph: SessionStateGraph) => void;
	readonly composerEndDispatch: (sessionId: string) => void;
	readonly handleCanonicalTurnComplete: (sessionId: string, lastTerminalTurnId?: string) => void;
	readonly handleCanonicalTurnFailure: (sessionId: string, error: TurnErrorUpdate) => void;
	readonly refreshSessionStateSnapshot: (sessionId: string) => InflightSessionStateRefresh;
};

export class SessionEnvelopeApplier {
	readonly #deps: SessionEnvelopeApplierDeps;

	constructor(deps: SessionEnvelopeApplierDeps) {
		this.#deps = deps;
	}

	applySessionStateGraph(graph: SessionStateGraph): void {
		this.#deps.syncSessionSequenceFromGraph(graph);
		const sessionId = graph.canonicalSessionId;
		const previousTransientProjection = this.#deps.getTransientProjection(sessionId);
		const previousProjection = this.#deps.getCanonicalProjection(sessionId);
		seedTranscriptEntryIndex(graph.transcriptSnapshot.entries);
		this.#deps.setSessionStateGraph(sessionId, graph);
		const canonicalCapabilities = sanitizeCanonicalCapabilities(graph.capabilities);
		this.#deps.setCapabilitiesMaterialized(sessionId, true);
		const activeTurnFailure = mapProjectionTurnFailure(graph.activeTurnFailure ?? null);
		const nextLastTerminalTurnId = graph.lastTerminalTurnId ?? null;
		this.#deps.setCanonicalProjection(sessionId, {
			lifecycle: graph.lifecycle,
			activity: graph.activity,
			turnState: graph.turnState,
			activeTurnFailure,
			lastTerminalTurnId: nextLastTerminalTurnId,
			activeStreamingTail: graph.activeStreamingTail ?? null,
			capabilities: canonicalCapabilities,
			revision: graph.revision,
		});
		this.#applyCanonicalTerminalTurnSideEffects({
			sessionId,
			previousProjection,
			turnState: graph.turnState,
			activeTurnFailure,
			projectedFailure: graph.activeTurnFailure ?? null,
			lastTerminalTurnId: nextLastTerminalTurnId,
		});

		const updates: SessionTransientProjectionUpdates = {
			acpSessionId: graph.lifecycle.status === "ready" ? sessionId : null,
			capabilityMutationState: {
				pendingMutationId: null,
				previewState: deriveCapabilityPreviewState(canonicalCapabilities),
			},
		};
		if (previousProjection?.lifecycle.status !== graph.lifecycle.status) {
			updates.statusChangedAt = Date.now();
		}
		if (previousTransientProjection.autonomousTransition !== "idle") {
			updates.autonomousTransition = "idle";
		}

		this.#deps.updateTransientProjection(sessionId, updates);
		this.#deps.reconcileConnectionMachine(
			sessionId,
			graph.lifecycle,
			graph.turnState,
			activeTurnFailure
		);
	}

	applySessionStateEnvelope(sessionId: string, envelope: SessionStateEnvelope): void {
		const commands = routeSessionStateEnvelope(
			sessionId,
			this.#deps.getGraphRevision(sessionId),
			envelope
		);

		for (const command of commands) {
			if (command.kind === "rejectOversizedEnvelope") {
				logger.warn("Rejected oversized session-state envelope", {
					sessionId,
					kind: command.budget.kind,
					byteLength: command.budget.byteLength,
					maxBytes: command.budget.maxBytes,
				});
				continue;
			}

			if (command.kind === "rejectSessionMismatch") {
				logger.warn("Rejected session-state envelope for another session", {
					sessionId,
					envelopeSessionId: command.envelopeSessionId,
					expectedSessionId: command.expectedSessionId,
				});
				continue;
			}

			this.#applyEnvelopeReducerCommand(sessionId, command);
		}
	}

	applyTranscriptDelta(
		sessionId: string,
		delta: TranscriptDelta,
		revision?: SessionGraphRevision
	): void {
		const snapshot = this.#assembleEnvelopeReducerSnapshot(sessionId);
		const patches = reduceTranscriptDelta(snapshot, delta, revision);
		this.#applyEnvelopePatches(sessionId, patches);
	}

	#assembleEnvelopeReducerSnapshot(sessionId: string): EnvelopeReducerSnapshot {
		return {
			sessionId,
			hasSessionIdentity: this.#deps.getSessionIdentity(sessionId) !== undefined,
			previousProjection: this.#deps.getCanonicalProjection(sessionId),
			previousGraph: this.#deps.getSessionStateGraph(sessionId),
			capabilitiesMaterialized: this.#deps.getCapabilitiesMaterialized(sessionId),
			transientProjection: this.#deps.getTransientProjection(sessionId),
			currentModelId: this.#deps.getSessionCurrentModelId(sessionId),
			sessionCold: this.#deps.getSessionCold(sessionId),
		};
	}

	#applyEnvelopePatches(sessionId: string, patches: readonly EnvelopePatch[]): void {
		const callbacks = this.#deps.getCallbacks();
		for (const patch of patches) {
			switch (patch.kind) {
				case "setCapabilitiesMaterialized":
					this.#deps.setCapabilitiesMaterialized(sessionId, patch.materialized);
					break;
				case "setCanonicalProjection":
					this.#deps.setCanonicalProjection(sessionId, patch.projection);
					break;
				case "setSessionStateGraph":
					this.#deps.setSessionStateGraph(sessionId, patch.graph);
					break;
				case "updateTransientProjection":
					this.#deps.updateTransientProjection(sessionId, patch.updates);
					break;
				case "setUsageTelemetry":
					this.#deps.updateUsageTelemetry(sessionId, patch.telemetry);
					break;
				case "notifyPlanUpdate":
					callbacks.onPlanUpdate?.(sessionId, patch.plan);
					break;
				case "applyViewportBufferPush":
					this.#deps.applyViewportBufferPush(patch.push);
					break;
				case "applyViewportBufferDelta":
					this.#deps.applyViewportBufferDelta(patch.delta);
					break;
				case "replaceSessionOperations":
					this.#deps.replaceSessionOperations(patch.sessionId, patch.operations);
					break;
				case "replaceTranscriptSnapshot":
					this.#deps.replaceTranscriptSnapshot(
						patch.sessionId,
						patch.snapshot,
						new Date(patch.appliedAtMs)
					);
					break;
				case "applyTranscriptDeltaToEntryStore":
					this.#deps.applyTranscriptDeltaToEntryStore(
						patch.sessionId,
						patch.delta,
						new Date(patch.appliedAtMs)
					);
					break;
				case "applySessionOperationPatches":
					this.#deps.applySessionOperationPatches(patch.sessionId, patch.patches);
					break;
				case "replaceLiveSessionStateGraph":
					this.#deps.replaceLiveSessionStateGraph(patch.graph);
					break;
				case "applyLiveSessionInteractionPatches":
					this.#deps.applyLiveSessionInteractionPatches(patch.snapshots);
					break;
				case "applySessionStateGraph":
					this.applySessionStateGraph(patch.graph);
					break;
				case "syncAwaitingModelRefreshTimer":
					this.#deps.syncAwaitingModelRefreshTimer(
						patch.sessionId,
						patch.activity,
						patch.turnState
					);
					break;
				case "reconcileConnectionMachine":
					this.#deps.reconcileConnectionMachine(
						patch.sessionId,
						patch.lifecycle,
						patch.turnState,
						patch.activeTurnFailure
					);
					break;
				case "invokeCanonicalTerminalTurnSideEffects":
					this.#applyCanonicalTerminalTurnSideEffects({
						sessionId: patch.sessionId,
						previousProjection: patch.previousProjection,
						turnState: patch.turnState,
						activeTurnFailure: patch.activeTurnFailure,
						projectedFailure: patch.projectedFailure,
						lastTerminalTurnId: patch.lastTerminalTurnId,
					});
					break;
				case "refreshSessionStateSnapshot":
					if (patch.warnContext !== undefined) {
						logger.warn("Refreshing session-state snapshot for transcript frontier mismatch", {
							sessionId: patch.sessionId,
							currentRevision: patch.warnContext.currentTranscriptRevision,
							fromRevision: patch.warnContext.fromRevision,
							toRevision: patch.warnContext.toRevision,
						});
					}
					void this.#deps.refreshSessionStateSnapshot(patch.sessionId).match(
						() => undefined,
						() => undefined
					);
					break;
				case "warnMissingCanonicalProjection":
					logger.warn("Received session-state graph patches before canonical projection", {
						sessionId: patch.sessionId,
						revision: patch.context.revision,
					});
					break;
			}
		}
	}

	#logEnvelopeReducerNoop(
		sessionId: string,
		command: SessionStateCommand,
		snapshot: EnvelopeReducerSnapshot,
		patches: readonly EnvelopePatch[]
	): void {
		if (patches.length > 0) {
			return;
		}

		if (command.kind === "applyTelemetry") {
			const previousProjection = snapshot.previousProjection;
			if (
				previousProjection !== null &&
				!isNewerGraphRevision(previousProjection.revision, command.revision)
			) {
				logger.debug("Ignoring stale session-state telemetry envelope", {
					sessionId,
					currentRevision: previousProjection.revision,
					incomingRevision: command.revision,
				});
			}
			return;
		}

		if (command.kind === "applyPlan") {
			const previousProjection = snapshot.previousProjection;
			if (
				previousProjection !== null &&
				!isNewerGraphRevision(previousProjection.revision, command.revision)
			) {
				logger.debug("Ignoring stale session-state plan envelope", {
					sessionId,
					currentRevision: previousProjection.revision,
					incomingRevision: command.revision,
				});
			}
			return;
		}

		if (command.kind === "replaceGraph") {
			const previousGraph = snapshot.previousGraph;
			const previousProjection = snapshot.previousProjection;
			const currentRevision = previousProjection?.revision ?? previousGraph?.revision ?? null;
			if (!isNewerGraphRevision(currentRevision, command.graph.revision)) {
				logger.debug("Ignoring stale session-state graph snapshot", {
					sessionId,
					currentRevision,
					incomingRevision: command.graph.revision,
				});
			}
			return;
		}

		if (command.kind === "applyLifecycle") {
			if (isOlderGraphRevision(snapshot.previousProjection?.revision ?? null, command.revision)) {
				logger.debug("Ignoring stale session-state lifecycle envelope", {
					sessionId,
					currentRevision: snapshot.previousProjection?.revision ?? null,
					incomingRevision: command.revision,
				});
			}
			return;
		}

		if (command.kind === "applyGraphPatches") {
			const previousProjection = snapshot.previousProjection;
			if (
				previousProjection !== null &&
				!isNewerGraphRevision(previousProjection.revision, command.revision)
			) {
				logger.debug("Ignoring stale session-state graph patch", {
					sessionId,
					currentRevision: previousProjection.revision,
					incomingRevision: command.revision,
				});
			}
			return;
		}
	}

	#applyEnvelopeReducerCommand(sessionId: string, command: SessionStateCommand): void {
		const snapshot = this.#assembleEnvelopeReducerSnapshot(sessionId);
		const patches = reduceCommand(snapshot, command, Date.now());
		this.#logEnvelopeReducerNoop(sessionId, command, snapshot, patches);
		if (command.kind === "replaceGraph" && patches.length > 0) {
			const replacedTranscript = patches.some(
				(patch) => patch.kind === "replaceTranscriptSnapshot"
			);
			if (!replacedTranscript) {
				const previousGraph = snapshot.previousGraph;
				logger.debug("Ignoring non-advancing session-state transcript snapshot", {
					sessionId,
					currentTranscriptRevision: previousGraph?.transcriptSnapshot.revision,
					incomingTranscriptRevision: command.graph.transcriptSnapshot.revision,
					graphRevision: command.graph.revision.graphRevision,
					lastEventSeq: command.graph.revision.lastEventSeq,
				});
			}
		}
		this.#applyEnvelopePatches(sessionId, patches);
	}

	#applyCanonicalTerminalTurnSideEffects(input: {
		sessionId: string;
		previousProjection: CanonicalSessionProjection | null;
		turnState: SessionTurnState;
		activeTurnFailure: ActiveTurnFailure | null;
		projectedFailure: TurnFailureSnapshot | null;
		lastTerminalTurnId: string | null;
	}): void {
		const callbacks = this.#deps.getCallbacks();
		const isNewCompletedTurn =
			input.previousProjection !== null &&
			input.turnState === "Completed" &&
			(input.previousProjection.turnState !== "Completed" ||
				input.previousProjection.lastTerminalTurnId !== input.lastTerminalTurnId);
		const isNewFailedTurn =
			input.previousProjection !== null &&
			input.turnState === "Failed" &&
			input.activeTurnFailure !== null &&
			(input.previousProjection.turnState !== "Failed" ||
				input.previousProjection.lastTerminalTurnId !== input.lastTerminalTurnId);
		if (isNewCompletedTurn) {
			this.#deps.composerEndDispatch(input.sessionId);
			this.#deps.handleCanonicalTurnComplete(
				input.sessionId,
				input.lastTerminalTurnId ?? undefined
			);
			callbacks.onTurnComplete?.(input.sessionId);
			void this.#deps.refreshSessionStateSnapshot(input.sessionId).match(
				() => undefined,
				() => undefined
			);
		}

		if (!isNewFailedTurn || input.projectedFailure === null) {
			return;
		}

		this.#deps.composerEndDispatch(input.sessionId);
		this.#deps.handleCanonicalTurnFailure(input.sessionId, {
			type: "turnError",
			session_id: input.sessionId,
			turn_id: input.projectedFailure.turn_id ?? undefined,
			error: {
				message: input.projectedFailure.message,
				code: input.projectedFailure.code != null ? input.projectedFailure.code : undefined,
				details:
					input.projectedFailure.details != null ? input.projectedFailure.details : undefined,
				kind: input.projectedFailure.kind,
				source: input.projectedFailure.source ?? "unknown",
			},
		});
		callbacks.onTurnError?.(input.sessionId);
	}
}
