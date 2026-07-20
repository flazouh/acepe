import type { InteractionStore } from "$lib/acp/store/interaction-store.svelte.js";
import type { PlanApprovalInteraction } from "$lib/acp/types/interaction.js";
import type { PermissionRequest } from "$lib/acp/types/permission.js";
import type { QuestionRequest } from "$lib/acp/types/question.js";
import type { InteractionSnapshot, SessionStateGraph } from "$lib/services/acp-types.js";

interface LiveInteractionGraphConsumerInput {
	readonly interactionStore: InteractionStore;
	readonly showPermissionNotification: (permission: PermissionRequest) => void;
	readonly showQuestionNotification: (question: QuestionRequest) => void;
	readonly showPlanApprovalNotification: (approval: PlanApprovalInteraction) => void;
}

interface SessionOpenInteractionGraphConsumerInput {
	readonly interactionStore: InteractionStore;
}

interface PendingInteractionIds {
	readonly permissionIds: Set<string>;
	readonly questionIds: Set<string>;
	readonly planApprovalIds: Set<string>;
}

function collectPendingInteractionIdsForSession(
	interactionStore: InteractionStore,
	sessionId: string
): PendingInteractionIds {
	const permissionIds = new Set<string>();
	const questionIds = new Set<string>();
	const planApprovalIds = new Set<string>();

	for (const [id, permission] of interactionStore.permissionsPending) {
		if (permission.sessionId === sessionId) {
			permissionIds.add(id);
		}
	}
	for (const [id, question] of interactionStore.questionsPending) {
		if (question.sessionId === sessionId) {
			questionIds.add(id);
		}
	}
	for (const [id, approval] of interactionStore.planApprovalsPending) {
		if (approval.sessionId === sessionId && approval.status === "pending") {
			planApprovalIds.add(id);
		}
	}

	return {
		permissionIds,
		questionIds,
		planApprovalIds,
	};
}

function collectPatchSessionIds(patches: readonly InteractionSnapshot[]): Set<string> {
	const sessionIds = new Set<string>();
	for (const interaction of patches) {
		sessionIds.add(interaction.session_id);
	}
	return sessionIds;
}

function collectPendingInteractionIdsForPatches(
	interactionStore: InteractionStore,
	patches: readonly InteractionSnapshot[]
): PendingInteractionIds {
	const sessionIds = collectPatchSessionIds(patches);
	const permissionIds = new Set<string>();
	const questionIds = new Set<string>();
	const planApprovalIds = new Set<string>();

	for (const [id, permission] of interactionStore.permissionsPending) {
		if (sessionIds.has(permission.sessionId)) {
			permissionIds.add(id);
		}
	}
	for (const [id, question] of interactionStore.questionsPending) {
		if (sessionIds.has(question.sessionId)) {
			questionIds.add(id);
		}
	}
	for (const [id, approval] of interactionStore.planApprovalsPending) {
		if (sessionIds.has(approval.sessionId) && approval.status === "pending") {
			planApprovalIds.add(id);
		}
	}

	return {
		permissionIds,
		questionIds,
		planApprovalIds,
	};
}

function notifyNewPendingInteractions(
	input: LiveInteractionGraphConsumerInput,
	sessionIds: ReadonlySet<string>,
	previousIds: PendingInteractionIds
): void {
	for (const [id, permission] of input.interactionStore.permissionsPending) {
		if (sessionIds.has(permission.sessionId) && !previousIds.permissionIds.has(id)) {
			input.showPermissionNotification(permission);
		}
	}
	for (const [id, question] of input.interactionStore.questionsPending) {
		if (sessionIds.has(question.sessionId) && !previousIds.questionIds.has(id)) {
			input.showQuestionNotification(question);
		}
	}
	for (const [id, approval] of input.interactionStore.planApprovalsPending) {
		if (
			sessionIds.has(approval.sessionId) &&
			approval.status === "pending" &&
			!previousIds.planApprovalIds.has(id)
		) {
			input.showPlanApprovalNotification(approval);
		}
	}
}

export function createLiveInteractionGraphConsumer(input: LiveInteractionGraphConsumerInput): {
	readonly replaceSessionStateGraph: (graph: SessionStateGraph) => void;
	readonly applySessionInteractionPatches: (patches: readonly InteractionSnapshot[]) => void;
} {
	return {
		replaceSessionStateGraph(graph) {
			const previousIds = collectPendingInteractionIdsForSession(
				input.interactionStore,
				graph.canonicalSessionId
			);
			input.interactionStore.replaceSessionStateGraph(graph);
			notifyNewPendingInteractions(input, new Set([graph.canonicalSessionId]), previousIds);
		},
		applySessionInteractionPatches(patches) {
			const previousIds = collectPendingInteractionIdsForPatches(input.interactionStore, patches);
			input.interactionStore.applySessionInteractionPatches(patches);
			notifyNewPendingInteractions(input, collectPatchSessionIds(patches), previousIds);
		},
	};
}

export function createSessionOpenInteractionGraphConsumer(
	input: SessionOpenInteractionGraphConsumerInput
): {
	readonly replaceSessionStateGraph: (graph: SessionStateGraph) => void;
} {
	return {
		replaceSessionStateGraph(graph) {
			input.interactionStore.replaceSessionStateGraph(graph);
		},
	};
}
