import type {
	InteractionSnapshot,
	OperationSnapshot,
	SessionGraphCapabilities,
	SessionGraphLifecycle,
	SessionGraphLifecycleStatus,
	SessionGraphRevision,
	SessionOpenFound,
	SessionStateDelta,
	SessionStateEnvelope,
	SessionStateGraph,
	SessionStatePayload,
	SessionStateSnapshotMaterialization,
} from "../../services/acp-types.js";

export type {
	SessionGraphCapabilities,
	SessionGraphLifecycle,
	SessionGraphLifecycleStatus,
	SessionGraphRevision,
	SessionStateDelta,
	SessionStateEnvelope,
	SessionStateGraph,
	SessionStatePayload,
	SessionStateSnapshotMaterialization,
};

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
			graphRevision: found.lastEventSeq,
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
		status: "idle",
		errorMessage: null,
		canReconnect: true,
	};
}

export function defaultSnapshotCapabilities(): SessionGraphCapabilities {
	return {
		models: null,
		modes: null,
		availableCommands: [],
		configOptions: [],
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
	const operationIds: string[] = graph.operations.map((operation: OperationSnapshot) => operation.id);
	const interactionIds: string[] = graph.interactions.map(
		(interaction: InteractionSnapshot) => interaction.id
	);
	return {
		operationIds,
		interactionIds,
	};
}
