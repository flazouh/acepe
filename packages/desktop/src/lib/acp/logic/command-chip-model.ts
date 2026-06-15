import type { CommandChipModel } from "@acepe/ui/agent-panel";
import type { TranscriptSegment } from "../../services/acp-types.js";
import {
	buildCommandOutputCardState,
	type CommandModelInfo,
} from "../components/messages/command-output-card-state.js";

function isModelCommandSegment(
	segment: Extract<TranscriptSegment, { kind: "localCommand" }>
): boolean {
	return (
		segment.command === "/model" ||
		segment.message === "model" ||
		Boolean(segment.modelDisplayName) ||
		Boolean(segment.modelDescription)
	);
}

function structuredModelInfo(
	segment: Extract<TranscriptSegment, { kind: "localCommand" }>
): CommandModelInfo | null {
	if (segment.modelDisplayName && segment.modelDisplayName.length > 0) {
		return {
			name: segment.modelDisplayName,
			description: segment.modelDescription ?? null,
		};
	}
	return null;
}

export function buildCommandChipModelFromSegment(
	segment: Extract<TranscriptSegment, { kind: "localCommand" }>
): CommandChipModel {
	const structured = structuredModelInfo(segment);
	const cardState = buildCommandOutputCardState(
		{
			command: segment.command,
			message: segment.message,
			args: segment.args,
			stdout: segment.stdout,
		},
		structured
	);

	return {
		command: segment.command,
		message: segment.message,
		stdout: segment.stdout,
		modelDisplayName: segment.modelDisplayName ?? null,
		modelDescription: segment.modelDescription ?? null,
		cleanStdout: cardState.cleanStdout,
		displayModelName: cardState.displayModel.name,
		displayModelDescription: cardState.displayModel.description,
		isModelCommand: isModelCommandSegment(segment) || cardState.isModelCommand,
	};
}
