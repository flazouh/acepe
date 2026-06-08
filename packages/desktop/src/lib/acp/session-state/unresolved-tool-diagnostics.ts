/**
 * Opt-in diagnostic logging for unresolved restored tool rows in the
 * agent-panel graph materializer (gated behind the
 * `acepe:debug:unresolved-tools` localStorage flag). Read-only over the
 * canonical source — emits a console.warn sample, never mutates state.
 */
import type { TranscriptEntry } from "../../services/acp-types.js";
import type { AgentPanelCanonicalSource } from "./agent-panel-canonical-source.js";
import type { OperationIndex } from "./operation-index.js";
import { segmentText } from "./transcript-text.js";

const UNRESOLVED_TOOL_DIAGNOSTIC_SAMPLE_LIMIT = 40;

function shouldLogUnresolvedToolDiagnostics(): boolean {
	if (typeof localStorage === "undefined" || typeof localStorage.getItem !== "function") {
		return false;
	}

	return localStorage.getItem("acepe:debug:unresolved-tools") === "1";
}

function countSampledToolTranscriptEntries(
	entries: readonly TranscriptEntry[],
	limit: number
): number {
	let count = 0;
	const sampleLength = Math.min(entries.length, limit);
	for (let index = 0; index < sampleLength; index += 1) {
		if (entries[index]?.role === "tool") {
			count += 1;
		}
	}
	return count;
}

export function logUnresolvedToolDiagnostics(
	entry: TranscriptEntry,
	graph: AgentPanelCanonicalSource,
	index: OperationIndex
): void {
	if (!shouldLogUnresolvedToolDiagnostics()) {
		return;
	}

	const transcriptLinkedEntryIds = Array.from(index.byTranscriptSourceEntryId.keys()).slice(
		0,
		UNRESOLVED_TOOL_DIAGNOSTIC_SAMPLE_LIMIT
	);
	const operationSummaries = graph.operations
		.slice(0, UNRESOLVED_TOOL_DIAGNOSTIC_SAMPLE_LIMIT)
		.map((operation) => {
			return {
				id: operation.id,
				toolCallId: operation.tool_call_id,
				name: operation.name,
				title: operation.title,
				state: operation.operation_state,
				sourceLink: operation.source_link,
			};
		});
	const sampledToolTranscriptEntryCount = countSampledToolTranscriptEntries(
		graph.transcriptSnapshot.entries,
		UNRESOLVED_TOOL_DIAGNOSTIC_SAMPLE_LIMIT
	);

	console.warn("[agent-panel] unresolved restored tool row", {
		sessionId: graph.canonicalSessionId,
		agentId: graph.agentId,
		graphRevision: graph.revision.graphRevision,
		transcriptRevision: graph.revision.transcriptRevision,
		lastEventSeq: graph.revision.lastEventSeq,
		turnState: graph.turnState,
		entryId: entry.entryId,
		entrySegmentCount: entry.segments.length,
		entryTextLength: segmentText(entry).length,
		sampledToolTranscriptEntryCount,
		toolTranscriptEntrySampleLimit: UNRESOLVED_TOOL_DIAGNOSTIC_SAMPLE_LIMIT,
		operationCount: graph.operations.length,
		transcriptLinkedEntryIds,
		operationSummaries,
	});
}
