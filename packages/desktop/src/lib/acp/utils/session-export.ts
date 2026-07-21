import type { SessionStateGraph } from "../../services/acp-types.js";
import type { SessionCold } from "../application/dto/session-cold.js";

interface CanonicalSessionExportData {
	readonly session: SessionCold;
	readonly transcriptSnapshot: SessionStateGraph["transcriptSnapshot"];
	readonly operations: SessionStateGraph["operations"];
	readonly interactions: SessionStateGraph["interactions"];
	readonly revision: SessionStateGraph["revision"];
	readonly entryCount: number;
}

export function sessionGraphToJsonExportContent(
	session: SessionCold,
	graph: SessionStateGraph
): string {
	const payload: CanonicalSessionExportData = {
		session,
		transcriptSnapshot: graph.transcriptSnapshot,
		operations: graph.operations,
		interactions: graph.interactions,
		revision: graph.revision,
		entryCount: graph.transcriptSnapshot.entries.length,
	};

	return JSON.stringify(payload, null, 2);
}
