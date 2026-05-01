import type { ToolArguments } from "../../../../services/converted-session-types.js";

export type ToolCallEditDiff = {
	readonly filePath: string | null;
	readonly oldString: string | null;
	readonly newString: string | null;
};

/**
 * cc-sdk / Cursor may stream replacement text as a truncated envelope instead of a raw string:
 * `{ value: string; truncated?: boolean; originalChars?: number }`.
 * Generated `EditEntry` types only describe `string`, so we normalize at the boundary.
 */
function coerceEditText(value: unknown): string | null {
	if (value === null || value === undefined) {
		return null;
	}
	if (typeof value === "string") {
		return value;
	}
	if (typeof value === "object" && !Array.isArray(value)) {
		const envelope = value as { value?: unknown };
		if (typeof envelope.value === "string") {
			return envelope.value;
		}
	}
	return null;
}

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
			oldString: coerceEditText(edit.oldString),
			newString: coerceEditText(edit.newString ?? edit.content),
		}));
	}

	const maxLength = Math.max(baseEdits.length, streamingEdits.length);

	return Array.from({ length: maxLength }, (_, index) => {
		const baseEdit = baseEdits[index];
		const streamingEdit = streamingEdits[index];

		const mergedNew =
			streamingEdit?.newString ??
			streamingEdit?.content ??
			baseEdit?.newString ??
			baseEdit?.content ??
			null;
		const mergedOld = streamingEdit?.oldString ?? baseEdit?.oldString ?? null;

		return {
			filePath: streamingEdit?.filePath ?? baseEdit?.filePath ?? null,
			oldString: coerceEditText(mergedOld),
			newString: coerceEditText(mergedNew),
		};
	});
}
