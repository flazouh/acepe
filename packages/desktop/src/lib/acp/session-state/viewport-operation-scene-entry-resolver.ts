import type { AgentPanelSceneEntryModel } from "@acepe/ui/agent-panel/types";
import type { OperationSnapshot, TranscriptViewportRow } from "../../services/acp-types.js";
import type { AgentPanelCanonicalSource } from "./agent-panel-canonical-source.js";
import { materializeOperationSceneEntry } from "./entry-materializers.js";
import { buildOperationIndex, type OperationIndex } from "./operation-index.js";

export type ViewportOperationSceneEntryResolver = (
	row: TranscriptViewportRow
) => AgentPanelSceneEntryModel | null;

function operationMatchesViewportRow(
	operation: OperationSnapshot,
	row: TranscriptViewportRow
): boolean {
	return (
		operation.source_link.kind === "transcript_linked" &&
		operation.source_link.entry_id === row.sourceEntryId
	);
}

function resolveLinkedOperation(
	row: TranscriptViewportRow,
	index: OperationIndex
): OperationSnapshot | null {
	const operationLink = row.operationLinks[0];
	if (operationLink === undefined) {
		return null;
	}

	const embeddedOperation = operationLink.operation ?? null;
	if (embeddedOperation !== null) {
		if (
			embeddedOperation.id !== operationLink.operationId ||
			embeddedOperation.tool_call_id !== operationLink.toolCallId
		) {
			return null;
		}
		if (operationMatchesViewportRow(embeddedOperation, row)) {
			return embeddedOperation;
		}
	}

	const operation = index.byOperationId.get(operationLink.operationId);
	return operation !== undefined && operationMatchesViewportRow(operation, row) ? operation : null;
}

export function createViewportOperationSceneEntryResolver(
	graph: AgentPanelCanonicalSource | null
): ViewportOperationSceneEntryResolver | null {
	if (graph === null) {
		return null;
	}

	const index = buildOperationIndex(graph.operations);
	const entryByOperationId = new Map<string, AgentPanelSceneEntryModel>();

	return (row: TranscriptViewportRow): AgentPanelSceneEntryModel | null => {
		if (row.kind !== "tool") {
			return null;
		}
		const operation = resolveLinkedOperation(row, index);
		if (operation === null) {
			return null;
		}

		const cached = entryByOperationId.get(operation.id);
		if (cached !== undefined) {
			return cached;
		}

		const entry = materializeOperationSceneEntry({
			operation,
			graph,
			index,
			displayEntryId: row.sourceEntryId,
		});
		entryByOperationId.set(operation.id, entry);
		return entry;
	};
}
