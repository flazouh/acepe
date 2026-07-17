/**
 * SessionPresentationModel — queue/list/live-work/panel presentation derived from
 * canonical projections and operation state (see docs/adr/0002).
 */
import type {
	InteractionSnapshot,
	QuestionData,
	SessionStateGraph,
} from "../../services/acp-types.js";
import {
	agentPanelCanonicalSourceFromGraph,
	type AgentPanelCanonicalSource,
} from "../session-state/agent-panel-canonical-source.js";
import type { ActiveTurnFailure } from "../types/turn-error.js";
import type { CanonicalSessionProjection } from "./canonical-session-projection.js";
import type { InteractionStore } from "./interaction-store.svelte.js";
import {
	buildSessionOperationInteractionSnapshot,
	type SessionOperationInteractionSnapshot,
} from "./operation-association.js";
import { getPrimaryQuestionText } from "./question-selectors.js";
import { buildQueueSessionSnapshot, type QueueSessionSnapshot } from "./session-attention/utils.js";
import type { SessionLiveSyncReference } from "./session-cold-index.js";
import {
	deriveLiveSessionLifecyclePresentation,
	deriveLiveSessionState,
	deriveLiveSessionWorkProjection,
	inactiveSessionWorkSourceFromCanonicalProjection,
	liveSessionWorkSourceFromCanonicalProjection,
	type LiveSessionLifecyclePresentation,
	type LiveSessionWorkSource,
} from "./live-session-work.js";
import type { OperationStore } from "./operation-store.svelte.js";
import type { SessionTransientProjectionStore } from "./session-transient-projection-store.svelte.js";
import type { SessionMetadata } from "./types.js";

export type SessionQuestionInteractionSnapshot = InteractionSnapshot & {
	readonly kind: "Question";
	readonly payload: { readonly Question: QuestionData };
};

function isSessionQuestionInteraction(
	interaction: InteractionSnapshot
): interaction is SessionQuestionInteractionSnapshot {
	return interaction.kind === "Question" && "Question" in interaction.payload;
}

type SessionQueueSnapshotInput = {
	readonly sessionId: string;
	readonly agentId: string;
	readonly projectPath: string;
	readonly title: string | null;
	readonly updatedAt: Date;
	readonly interactionStore: InteractionStore;
	readonly hasUnseenCompletion: boolean;
	readonly active?: boolean;
};

type SessionListItemPresentationInput = {
	readonly sessionId: string;
	readonly interactionStore: InteractionStore;
	readonly hasUnseenCompletion: boolean;
	readonly active: boolean;
};

export type SessionPresentationModelDeps = {
	readonly getCanonicalProjection: (sessionId: string) => CanonicalSessionProjection | null;
	readonly getSessionStateGraph: (sessionId: string) => SessionStateGraph | null;
	readonly transientProjectionStore: SessionTransientProjectionStore;
	readonly operationStore: OperationStore;
	readonly getSessionCurrentModeId: (sessionId: string) => string | null;
	readonly getSessionConnectionError: (sessionId: string) => string | null;
	readonly getSessionActiveTurnFailure: (sessionId: string) => ActiveTurnFailure | null;
	readonly getSessionMetadata: (sessionId: string) => SessionMetadata | undefined;
	readonly hasSessionCanonicalProjection: (sessionId: string) => boolean;
};

export class SessionPresentationModel {
	readonly #deps: SessionPresentationModelDeps;

	constructor(deps: SessionPresentationModelDeps) {
		this.#deps = deps;
	}

	getSessionAgentPanelCanonicalSource(sessionId: string): AgentPanelCanonicalSource | null {
		const graph = this.#deps.getSessionStateGraph(sessionId);
		if (graph === null) {
			return null;
		}

		return agentPanelCanonicalSourceFromGraph(graph);
	}

	getSessionQuestionInteraction(
		sessionId: string,
		interactionId: string
	): SessionQuestionInteractionSnapshot | null {
		const graph = this.#deps.getSessionStateGraph(sessionId);
		if (graph === null) {
			return null;
		}

		for (const interaction of graph.interactions) {
			if (interaction.id !== interactionId) {
				continue;
			}
			if (!isSessionQuestionInteraction(interaction)) {
				return null;
			}
			return interaction;
		}

		return null;
	}

	getSessionLifecyclePresentation(sessionId: string): LiveSessionLifecyclePresentation {
		const projection = this.#deps.getCanonicalProjection(sessionId);
		const graph = this.#deps.getSessionStateGraph(sessionId);
		const transientProjection = this.#deps.transientProjectionStore.getTransientProjection(
			sessionId
		);

		return deriveLiveSessionLifecyclePresentation({
			source: liveSessionWorkSourceFromCanonicalProjection(sessionId, projection),
			hasEntries: graph === null ? null : graph.messageCount > 0,
			hasLocalPendingSendIntent: transientProjection.pendingSendIntent !== null,
		});
	}

	getSessionAgentPanelSessionSource(sessionId: string | null) {
		if (sessionId === null) {
			return {
				kind: "no_session" as const,
			};
		}

		const projection = this.#deps.getCanonicalProjection(sessionId);
		if (projection === null) {
			return {
				kind: "missing_canonical" as const,
				sessionId,
			};
		}

		return {
			kind: "canonical" as const,
			lifecycle: projection.lifecycle,
			activity: projection.activity,
			turnState: projection.turnState,
		};
	}

	getSessionLiveWorkSource(sessionId: string | null, active: boolean): LiveSessionWorkSource {
		const projection =
			sessionId === null ? null : this.#deps.getCanonicalProjection(sessionId);
		if (active) {
			return liveSessionWorkSourceFromCanonicalProjection(sessionId, projection);
		}
		return inactiveSessionWorkSourceFromCanonicalProjection(sessionId, projection);
	}

	getSessionOperationInteractionSnapshot(
		sessionId: string,
		interactions: InteractionStore
	): SessionOperationInteractionSnapshot {
		return buildSessionOperationInteractionSnapshot(
			sessionId,
			this.#deps.operationStore,
			interactions
		);
	}

	getSessionQueueSnapshot(input: SessionQueueSnapshotInput): QueueSessionSnapshot {
		const interactionSnapshot = this.getSessionOperationInteractionSnapshot(
			input.sessionId,
			input.interactionStore
		);
		return this.buildSessionQueueSnapshot(input, interactionSnapshot);
	}

	getSessionQueuePresentation(input: SessionQueueSnapshotInput) {
		const interactionSnapshot = this.getSessionOperationInteractionSnapshot(
			input.sessionId,
			input.interactionStore
		);
		const session = this.buildSessionQueueSnapshot(input, interactionSnapshot);
		const pendingQuestion = interactionSnapshot.pendingQuestion;
		const pendingPlanApproval = interactionSnapshot.pendingPlanApproval;
		const pendingPermission = interactionSnapshot.pendingPermission;
		const pendingComputerPermission = interactionSnapshot.pendingComputerPermission;

		return {
			session,
			hasPendingQuestion: pendingQuestion !== null,
			hasPendingPermission: pendingPermission !== null || pendingComputerPermission !== null,
			hasUnseenCompletion: session.state.attention.hasUnseenCompletion,
			pendingQuestionText: getPrimaryQuestionText(pendingQuestion),
			pendingQuestion,
			pendingPlanApproval,
			pendingComputerPermission,
			pendingPermission,
		};
	}

	getSessionListItemPresentation(input: SessionListItemPresentationInput) {
		const sessionId = input.sessionId;
		const currentModeId = this.#deps.getSessionCurrentModeId(sessionId);
		const currentStreamingToolCall = this.#deps.operationStore.getCurrentStreamingToolCall(
			sessionId
		);
		const lastToolCall = this.#deps.operationStore.getLastToolCall(sessionId);
		const lastTodoToolCall = this.#deps.operationStore.getLastTodoToolCall(sessionId);
		const currentToolKind = this.#deps.operationStore.getCurrentToolKind(sessionId);
		const interactionSnapshot = this.getSessionOperationInteractionSnapshot(
			sessionId,
			input.interactionStore
		);
		const liveSessionSource = this.getSessionLiveWorkSource(sessionId, input.active);
		const hasLocalPendingSendIntent =
			this.#deps.transientProjectionStore.getSessionHasLocalPendingSendIntent(sessionId);
		const liveSessionState = deriveLiveSessionState({
			source: liveSessionSource,
			currentModeId,
			interactionSnapshot,
			hasUnseenCompletion: input.hasUnseenCompletion,
			hasLocalPendingSendIntent,
		});
		const sessionWorkProjection = deriveLiveSessionWorkProjection({
			source: liveSessionSource,
			currentModeId,
			interactionSnapshot,
			hasUnseenCompletion: input.hasUnseenCompletion,
			hasLocalPendingSendIntent,
		});

		return {
			connectionError: this.#deps.getSessionConnectionError(sessionId),
			currentModeId,
			currentStreamingToolCall,
			lastToolCall,
			lastTodoToolCall,
			currentToolKind,
			lastToolKind: lastToolCall ? (lastToolCall.kind ?? "other") : null,
			liveSessionState,
			sessionWorkProjection,
			previewActivityKind: sessionWorkProjection.compactActivityKind,
			pendingQuestion: interactionSnapshot.pendingQuestion,
			pendingPermission: interactionSnapshot.pendingPermission,
			pendingComputerPermission: interactionSnapshot.pendingComputerPermission,
			pendingPlanApproval: interactionSnapshot.pendingPlanApproval,
		};
	}

	getLiveSessionPanelSyncInput(
		reference: SessionLiveSyncReference,
		interactions: InteractionStore
	) {
		const lifecyclePresentation = this.getSessionLifecyclePresentation(reference.id);
		const interactionSnapshot = this.getSessionOperationInteractionSnapshot(
			reference.id,
			interactions
		);
		const pendingQuestion = interactionSnapshot.pendingQuestion;
		const pendingPlanApproval = interactionSnapshot.pendingPlanApproval;
		const pendingPermission = interactionSnapshot.pendingPermission;
		const pendingComputerPermission = interactionSnapshot.pendingComputerPermission;

		return {
			sessionId: reference.id,
			updatedAtMs: reference.updatedAtMs,
			hasCanonicalProjection: this.#deps.hasSessionCanonicalProjection(reference.id),
			connectionPhase: lifecyclePresentation.connectionPhase,
			activityPhase: lifecyclePresentation.activityPhase,
			pendingQuestionId: pendingQuestion ? pendingQuestion.id : null,
			pendingPlanApprovalId: pendingPlanApproval ? pendingPlanApproval.id : null,
			pendingPermissionId:
				pendingPermission?.id ?? pendingComputerPermission?.id ?? null,
		};
	}

	private buildSessionQueueSnapshot(
		input: SessionQueueSnapshotInput,
		interactionSnapshot: Pick<
			SessionOperationInteractionSnapshot,
			"pendingPlanApproval" | "pendingPermission" | "pendingQuestion"
		> &
			Partial<Pick<SessionOperationInteractionSnapshot, "pendingComputerPermission">>
	): QueueSessionSnapshot {
		const sessionId = input.sessionId;
		return buildQueueSessionSnapshot({
			id: sessionId,
			agentId: input.agentId,
			projectPath: input.projectPath,
			title: input.title,
			currentStreamingToolCall: this.#deps.operationStore.getCurrentStreamingToolCall(sessionId),
			currentToolKind: this.#deps.operationStore.getCurrentToolKind(sessionId),
			lastToolCall: this.#deps.operationStore.getLastToolCall(sessionId),
			lastTodoToolCall: this.#deps.operationStore.getLastTodoToolCall(sessionId),
			updatedAt: input.updatedAt,
			currentModeId: this.#deps.getSessionCurrentModeId(sessionId),
			connectionError: this.#deps.getSessionConnectionError(sessionId),
			activeTurnFailure: this.#deps.getSessionActiveTurnFailure(sessionId),
			liveSessionSource: this.getSessionLiveWorkSource(sessionId, input.active ?? true),
			interactionSnapshot,
			hasUnseenCompletion: input.hasUnseenCompletion,
			hasLocalPendingSendIntent:
				this.#deps.transientProjectionStore.getSessionHasLocalPendingSendIntent(sessionId),
			sequenceId: this.#deps.getSessionMetadata(sessionId)?.sequenceId ?? null,
		});
	}
}
