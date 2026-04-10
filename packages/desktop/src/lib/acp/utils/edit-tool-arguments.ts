import type { EditEntry, ToolArguments } from "../../services/converted-session-types.js";

function normalizeNullableString(value: string | null | undefined): string | null {
	return typeof value === "string" ? value : null;
}

export function getEditEntries(
	toolArguments: ToolArguments | null | undefined
): readonly EditEntry[] {
	if (!toolArguments || toolArguments.kind !== "edit") {
		return [];
	}

	if (Array.isArray(toolArguments.edits) && toolArguments.edits.length > 0) {
		return toolArguments.edits;
	}

	return [];
}

export function getFirstEditEntry(
	toolArguments: ToolArguments | null | undefined
): EditEntry | null {
	const edits = getEditEntries(toolArguments);
	const firstEdit = edits[0];
	return firstEdit ? firstEdit : null;
}

export function getEditFilePath(toolArguments: ToolArguments | null | undefined): string | null {
	const firstEdit = getFirstEditEntry(toolArguments);
	if (!firstEdit) {
		return null;
	}

	return normalizeNullableString(firstEdit.filePath);
}

export function getEditOldString(toolArguments: ToolArguments | null | undefined): string | null {
	const firstEdit = getFirstEditEntry(toolArguments);
	if (!firstEdit) {
		return null;
	}

	return normalizeNullableString(firstEdit.oldString);
}

export function getEditNewString(toolArguments: ToolArguments | null | undefined): string | null {
	const firstEdit = getFirstEditEntry(toolArguments);
	if (!firstEdit) {
		return null;
	}

	return normalizeNullableString(firstEdit.newString);
}

export function getEditContent(toolArguments: ToolArguments | null | undefined): string | null {
	const firstEdit = getFirstEditEntry(toolArguments);
	if (!firstEdit) {
		return null;
	}

	return normalizeNullableString(firstEdit.content);
}

export function getEditPreviewContent(
	toolArguments: ToolArguments | null | undefined
): string | null {
	const newString = getEditNewString(toolArguments);
	if (newString !== null) {
		return newString;
	}

	return getEditContent(toolArguments);
}

export function withSingleEditEntry(
	_toolArguments: Extract<ToolArguments, { kind: "edit" }>,
	entry: EditEntry
): Extract<ToolArguments, { kind: "edit" }> {
	return {
		kind: "edit",
		edits: [entry],
	};
}
