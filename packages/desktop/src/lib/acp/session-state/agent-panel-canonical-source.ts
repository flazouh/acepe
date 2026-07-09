import type { SessionStateGraph } from "../../services/acp-types.js";

export type AgentPanelCanonicalSource = Pick<
	SessionStateGraph,
	| "canonicalSessionId"
	| "agentId"
	| "projectPath"
	| "revision"
	| "transcriptSnapshot"
	| "operations"
	| "interactions"
	| "turnState"
	| "messageCount"
	| "activeStreamingTail"
	| "lastTerminalTurnId"
	| "lifecycle"
	| "activity"
>;

export function agentPanelCanonicalSourceFromGraph(
	graph: SessionStateGraph
): AgentPanelCanonicalSource {
	return {
		canonicalSessionId: graph.canonicalSessionId,
		agentId: graph.agentId,
		projectPath: graph.projectPath,
		revision: graph.revision,
		transcriptSnapshot: graph.transcriptSnapshot,
		operations: graph.operations,
		interactions: graph.interactions,
		turnState: graph.turnState,
		messageCount: graph.messageCount,
		activeStreamingTail: graph.activeStreamingTail,
		lastTerminalTurnId: graph.lastTerminalTurnId,
		lifecycle: graph.lifecycle,
		activity: graph.activity,
	};
}
