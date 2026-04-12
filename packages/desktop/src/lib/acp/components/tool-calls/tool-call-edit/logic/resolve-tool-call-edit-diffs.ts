import type { EditDelta, ToolArguments } from "../../../../../services/converted-session-types.js";

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

function resolveEditFilePath(edit: EditDelta | undefined): string | null {
	return edit?.file_path ?? null;
}

function resolveEditOldString(edit: EditDelta | undefined): string | null {
	if (!edit) {
		return null;
	}

	if (edit.type === "writeFile") {
		return edit.previous_content ?? null;
	}

	return edit.old_text ?? null;
}

function resolveEditNewString(edit: EditDelta | undefined): string | null {
	if (!edit) {
		return null;
	}

	if (edit.type === "writeFile") {
		return edit.content ?? null;
	}

	if (edit.type === "replaceText") {
		return edit.new_text ?? null;
	}

	return null;
}

export function resolveToolCallEditDiffs(
	baseArguments: ToolArguments | null | undefined,
	streamingArguments: ToolArguments | null | undefined
): ToolCallEditDiff[] {
	const baseEdits = getEditEntries(baseArguments);
	const streamingEdits = getEditEntries(streamingArguments);

	if (streamingEdits.length === 0) {
		return baseEdits.map((edit) => ({
			filePath: resolveEditFilePath(edit),
			oldString: resolveEditOldString(edit),
			newString: resolveEditNewString(edit),
		}));
	}

	const maxLength = Math.max(baseEdits.length, streamingEdits.length);

	return Array.from({ length: maxLength }, (_, index) => {
		const baseEdit = baseEdits[index];
		const streamingEdit = streamingEdits[index];

		return {
			filePath: resolveEditFilePath(streamingEdit) ?? resolveEditFilePath(baseEdit),
			oldString: resolveEditOldString(streamingEdit) ?? resolveEditOldString(baseEdit),
			newString: resolveEditNewString(streamingEdit) ?? resolveEditNewString(baseEdit),
		};
	});
}
