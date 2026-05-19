import type {
	CapabilityPreviewState,
	InteractionSnapshot,
	OperationSnapshot,
	SessionGraphActivity,
	SessionGraphActivityKind,
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
	SessionGraphCapabilities,
	SessionGraphLifecycle,
	SessionGraphRevision,
	SessionStateDelta,
	SessionStateEnvelope,
	SessionStateGraph,
	SessionStatePayload,
	SessionStateSnapshotMaterialization,
};

export function graphFromSessionOpenFound(found: SessionOpenFound): SessionStateGraph {
	assertOpenFoundHasGraphAuthority(found);
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
		activeStreamingTail: found.activeStreamingTail ?? null,
		activeTurnFailure: found.activeTurnFailure,
		lastTerminalTurnId: found.lastTerminalTurnId,
		lifecycle: found.lifecycle,
		activity: found.activity,
		capabilities: found.capabilities,
	};
}

function assertOpenFoundHasGraphAuthority(found: SessionOpenFound): void {
	if (!found.lifecycle) {
		throw new Error("Session open result is missing canonical lifecycle authority");
	}
	if (!found.capabilities) {
		throw new Error("Session open result is missing canonical capabilities authority");
	}
	if (!found.activity) {
		throw new Error("Session open result is missing canonical activity authority");
	}
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
	return materializeSnapshotGraph(graphFromSessionOpenFound(found));
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
