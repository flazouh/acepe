import type {
	CapabilityPreviewState,
	InteractionSnapshot,
	OperationSnapshot,
	SessionGraphActivity,
	SessionGraphActivityKind,
	SessionGraphActionability,
	SessionGraphCapabilities,
	SessionGraphLifecycle,
	SessionGraphRevision,
	SessionOpenFound,
	SessionStateDelta,
	SessionStateEnvelope,
	SessionStateGraph,
	SessionStatePayload,
	SessionStateSnapshotMaterialization,
} from "../../services/acp-types.js";

export type {
	CapabilityPreviewState,
	SessionGraphActivity,
	SessionGraphActivityKind,
	SessionGraphActionability,
	SessionGraphCapabilities,
	SessionGraphLifecycle,
	SessionGraphRevision,
	SessionStateDelta,
	SessionStateEnvelope,
	SessionStateGraph,
	SessionStatePayload,
	SessionStateSnapshotMaterialization,
};

function isActiveOperation(operation: OperationSnapshot): boolean {
	return (
		operation.operation_state === "pending" ||
		operation.operation_state === "running" ||
		operation.operation_state === "blocked"
	);
}

function defaultLifecycleActionability(
	status: SessionGraphLifecycle["status"]
): SessionGraphActionability {
	return {
		canSend: status === "ready",
		canResume: status === "detached",
		canRetry: status === "failed",
		canArchive: status !== "archived",
		canConfigure: status === "ready",
		recommendedAction:
			status === "ready"
				? "send"
				: status === "detached"
					? "resume"
					: status === "failed"
						? "retry"
						: status === "archived"
							? "none"
							: "wait",
		recoveryPhase:
			status === "activating"
				? "activating"
				: status === "reconnecting"
					? "reconnecting"
					: status === "detached"
						? "detached"
						: status === "failed"
							? "failed"
							: status === "archived"
								? "archived"
								: "none",
		compactStatus: status,
	};
}

function selectSessionGraphActivity(input: {
	lifecycle: SessionGraphLifecycle;
	turnState: SessionStateGraph["turnState"];
	operations: OperationSnapshot[];
	interactions: InteractionSnapshot[];
	activeTurnFailure?: SessionStateGraph["activeTurnFailure"];
}): SessionGraphActivity {
	const activeOperations = input.operations.filter(isActiveOperation);
	const blockingInteraction =
		input.interactions.find((interaction) => interaction.state === "Pending") ?? null;
	const dominantOperationId = activeOperations[0]?.id ?? null;

	if (input.lifecycle.status === "failed" || input.activeTurnFailure != null) {
		return {
			kind: "error",
			activeOperationCount: activeOperations.length,
			activeSubagentCount: activeOperations.filter((operation) => operation.kind === "task").length,
			dominantOperationId,
			blockingInteractionId: blockingInteraction?.id ?? null,
		};
	}

	if (input.lifecycle.status === "detached" || input.lifecycle.status === "archived") {
		return {
			kind: "paused",
			activeOperationCount: activeOperations.length,
			activeSubagentCount: activeOperations.filter((operation) => operation.kind === "task").length,
			dominantOperationId,
			blockingInteractionId: blockingInteraction?.id ?? null,
		};
	}

	if (blockingInteraction !== null) {
		return {
			kind: "waiting_for_user",
			activeOperationCount: activeOperations.length,
			activeSubagentCount: activeOperations.filter((operation) => operation.kind === "task").length,
			dominantOperationId,
			blockingInteractionId: blockingInteraction.id,
		};
	}

	if (activeOperations.length > 0) {
		return {
			kind: "running_operation",
			activeOperationCount: activeOperations.length,
			activeSubagentCount: activeOperations.filter((operation) => operation.kind === "task").length,
			dominantOperationId,
			blockingInteractionId: null,
		};
	}

	if (input.turnState === "Running") {
		return {
			kind: "awaiting_model",
			activeOperationCount: 0,
			activeSubagentCount: 0,
			dominantOperationId: null,
			blockingInteractionId: null,
		};
	}

	return {
		kind: "idle",
		activeOperationCount: 0,
		activeSubagentCount: 0,
		dominantOperationId: null,
		blockingInteractionId: null,
	};
}

export function graphFromSessionOpenFound(
	found: SessionOpenFound,
	lifecycle: SessionGraphLifecycle,
	capabilities: SessionGraphCapabilities
): SessionStateGraph {
	return {
		requestedSessionId: found.requestedSessionId,
		canonicalSessionId: found.canonicalSessionId,
		isAlias: found.isAlias,
		agentId: found.agentId,
		projectPath: found.projectPath,
		worktreePath: found.worktreePath,
		sourcePath: found.sourcePath,
		revision: {
			graphRevision: found.graphRevision,
			transcriptRevision: found.transcriptSnapshot.revision,
			lastEventSeq: found.lastEventSeq,
		},
		transcriptSnapshot: found.transcriptSnapshot,
		operations: found.operations,
		interactions: found.interactions,
		turnState: found.turnState,
		messageCount: found.messageCount,
		activeTurnFailure: found.activeTurnFailure,
		lastTerminalTurnId: found.lastTerminalTurnId,
		lifecycle,
		activity: selectSessionGraphActivity({
			lifecycle,
			turnState: found.turnState,
			operations: found.operations,
			interactions: found.interactions,
			activeTurnFailure: found.activeTurnFailure,
		}),
		capabilities,
	};
}

export function createSnapshotEnvelope(graph: SessionStateGraph): SessionStateEnvelope {
	return {
		sessionId: graph.canonicalSessionId,
		graphRevision: graph.revision.graphRevision,
		lastEventSeq: graph.revision.lastEventSeq,
		payload: {
			kind: "snapshot",
			graph,
		},
	};
}

export function defaultSnapshotLifecycle(): SessionGraphLifecycle {
	return {
		status: "reserved",
		detachedReason: null,
		failureReason: null,
		errorMessage: null,
		actionability: defaultLifecycleActionability("reserved"),
	};
}

export function defaultSnapshotCapabilities(): SessionGraphCapabilities {
	return {
		models: null,
		modes: null,
		availableCommands: [],
		configOptions: [],
		autonomousEnabled: false,
	};
}

export function materializeSnapshotGraph(
	graph: SessionStateGraph
): SessionStateSnapshotMaterialization {
	return {
		graph,
	};
}

export function materializeSnapshotFromOpenFound(
	found: SessionOpenFound
): SessionStateSnapshotMaterialization {
	return materializeSnapshotGraph(
		graphFromSessionOpenFound(found, defaultSnapshotLifecycle(), defaultSnapshotCapabilities())
	);
}

export function listGraphAuthorityIds(graph: SessionStateGraph): {
	operationIds: string[];
	interactionIds: string[];
} {
	const operationIds: string[] = graph.operations.map(
		(operation: OperationSnapshot) => operation.id
	);
	const interactionIds: string[] = graph.interactions.map(
		(interaction: InteractionSnapshot) => interaction.id
	);
	return {
		operationIds,
		interactionIds,
	};
}
