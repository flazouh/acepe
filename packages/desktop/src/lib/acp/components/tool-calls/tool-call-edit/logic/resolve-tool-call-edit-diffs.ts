import type { ToolArguments } from "../../../../../services/converted-session-types.js";

export type ToolCallEditDiff = {
	readonly filePath: string | null;
	readonly oldString: string | null;
	readonly newString: string | null;
};

function getEditEntries(
	arguments_: ToolArguments | null | undefined
): Extract<ToolArguments, { kind: "edit" }>["edits"] {
	if (!arguments_ || arguments_.kind !== "edit") {
		return [];
	}

	return arguments_.edits;
}

export function resolveToolCallEditDiffs(
	baseArguments: ToolArguments | null | undefined,
	streamingArguments: ToolArguments | null | undefined
): ToolCallEditDiff[] {
	const baseEdits = getEditEntries(baseArguments);
	const streamingEdits = getEditEntries(streamingArguments);

	if (streamingEdits.length === 0) {
		return baseEdits.map((edit) => ({
			filePath: edit.filePath ?? null,
			oldString: edit.oldString ?? null,
			newString: edit.newString ?? edit.content ?? null,
		}));
	}

	const maxLength = Math.max(baseEdits.length, streamingEdits.length);

	return Array.from({ length: maxLength }, (_, index) => {
		const baseEdit = baseEdits[index];
		const streamingEdit = streamingEdits[index];

		return {
			filePath: streamingEdit?.filePath ?? baseEdit?.filePath ?? null,
			oldString: streamingEdit?.oldString ?? baseEdit?.oldString ?? null,
			newString:
				streamingEdit?.newString ??
				streamingEdit?.content ??
				baseEdit?.newString ??
				baseEdit?.content ??
				null,
		};
	});
}
