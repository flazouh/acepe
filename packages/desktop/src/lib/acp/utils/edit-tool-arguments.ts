import type { EditDelta, ToolArguments } from "../../services/converted-session-types.js";

function normalizeNullableString(value: string | null | undefined): string | null {
	return typeof value === "string" ? value : null;
}

export function getEditEntries(
	toolArguments: ToolArguments | null | undefined
): readonly EditDelta[] {
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
): EditDelta | null {
	const edits = getEditEntries(toolArguments);
	const firstEdit = edits[0];
	return firstEdit ? firstEdit : null;
}

function getEntryFilePath(entry: EditDelta): string | null {
	return normalizeNullableString(entry.file_path);
}

function getEntryOldString(entry: EditDelta): string | null {
	if (entry.type === "writeFile") {
		return normalizeNullableString(entry.previous_content);
	}

	return normalizeNullableString(entry.old_text);
}

function getEntryNewString(entry: EditDelta): string | null {
	if (entry.type === "writeFile") {
		return normalizeNullableString(entry.content);
	}

	if (entry.type === "replaceText") {
		return normalizeNullableString(entry.new_text);
	}

	return null;
}

export function getEditFilePath(toolArguments: ToolArguments | null | undefined): string | null {
	const firstEdit = getFirstEditEntry(toolArguments);
	if (!firstEdit) {
		return null;
	}

	return getEntryFilePath(firstEdit);
}

export function getEditOldString(toolArguments: ToolArguments | null | undefined): string | null {
	const firstEdit = getFirstEditEntry(toolArguments);
	if (!firstEdit) {
		return null;
	}

	return getEntryOldString(firstEdit);
}

export function getEditNewString(toolArguments: ToolArguments | null | undefined): string | null {
	const firstEdit = getFirstEditEntry(toolArguments);
	if (!firstEdit) {
		return null;
	}

	return getEntryNewString(firstEdit);
}

export function getEditContent(toolArguments: ToolArguments | null | undefined): string | null {
	const firstEdit = getFirstEditEntry(toolArguments);
	if (!firstEdit) {
		return null;
	}

	return firstEdit.type === "writeFile" ? normalizeNullableString(firstEdit.content) : null;
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
	entry: EditDelta
): Extract<ToolArguments, { kind: "edit" }> {
	return {
		kind: "edit",
		edits: [entry],
	};
}
