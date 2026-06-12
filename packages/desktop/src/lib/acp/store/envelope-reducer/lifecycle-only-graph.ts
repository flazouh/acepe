import type {
	CanonicalAgentId,
	SessionGraphActivity,
	SessionGraphCapabilities,
	SessionGraphLifecycle,
	SessionGraphRevision,
	SessionStateGraph,
	SessionTurnState,
	TurnFailureSnapshot,
} from "../../../services/acp-types.js";
import type { SessionCold } from "../../application/dto/session-cold.js";
import { isBuiltInCanonicalAgentId } from "../../types/agent-id.js";

function canonicalAgentIdFromSessionAgentId(agentId: string | null | undefined): CanonicalAgentId {
	if (agentId && isBuiltInCanonicalAgentId(agentId)) {
		return agentId;
	}

	return { custom: agentId ?? "unknown" };
}

export function createLifecycleOnlyGraph(input: {
	readonly sessionId: string;
	readonly session: SessionCold | undefined;
	readonly lifecycle: SessionGraphLifecycle;
	readonly activity: SessionGraphActivity;
	readonly turnState: SessionTurnState;
	readonly activeTurnFailure: TurnFailureSnapshot | null;
	readonly lastTerminalTurnId: string | null;
	readonly capabilities: SessionGraphCapabilities;
	readonly revision: SessionGraphRevision;
}): SessionStateGraph {
	return {
		requestedSessionId: input.sessionId,
		canonicalSessionId: input.sessionId,
		isAlias: false,
		agentId: canonicalAgentIdFromSessionAgentId(input.session?.agentId),
		projectPath: input.session?.projectPath ?? "",
		worktreePath: input.session?.worktreePath ?? null,
		sourcePath: input.session?.sourcePath ?? null,
		revision: input.revision,
		transcriptSnapshot: {
			revision: input.revision.transcriptRevision,
			entries: [],
		},
		operations: [],
		interactions: [],
		turnState: input.turnState,
		messageCount: 0,
		activeStreamingTail: null,
		activeTurnFailure: input.activeTurnFailure,
		lastTerminalTurnId: input.lastTerminalTurnId,
		lifecycle: input.lifecycle,
		activity: input.activity,
		capabilities: input.capabilities,
	};
}
