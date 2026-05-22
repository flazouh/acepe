import type { FileContents } from "@pierre/diffs";

export function hashEditDiffContent(content: string): string {
	let hash = 2_166_136_261;
	for (let index = 0; index < content.length; index += 1) {
		hash ^= content.charCodeAt(index);
		hash = Math.imul(hash, 16_777_619);
	}
	return (hash >>> 0).toString(36);
}

export function createEditDiffCacheKey(
	...parts: (string | null | undefined)[]
): string {
	return parts.map((part) => hashEditDiffContent(part ?? "")).join("-");
}

export function getEditDiffCacheKey(input: {
	oldString: string | null;
	newString: string | null;
	fileName: string | null;
}): string | null {
	if (!input.oldString && !input.newString) return null;
	return `edit-inline-${createEditDiffCacheKey(
		input.oldString,
		input.newString,
		input.fileName
	)}`;
}

export function getEditDiffFileContents(input: {
	oldString: string | null;
	newString: string | null;
	fileName: string | null;
	cacheKey: string | null;
}): { oldFile: FileContents; newFile: FileContents } | null {
	if (input.newString === null) return null;

	const effectiveFileName = input.fileName || "file.txt";

	return {
		oldFile: {
			name: effectiveFileName,
			contents: input.oldString || "",
			cacheKey: input.cacheKey ? `${input.cacheKey}-old` : undefined,
		},
		newFile: {
			name: effectiveFileName,
			contents: input.newString,
			cacheKey: input.cacheKey ? `${input.cacheKey}-new` : undefined,
		},
	};
}

export function isEditDiffClickable(input: {
	isExpanded: boolean;
	isStreaming: boolean;
}): boolean {
	return !input.isExpanded && !input.isStreaming;
}

export function getEditDiffContainerClass(input: {
	isExpanded: boolean;
	isClickable: boolean;
}): string {
	const base =
		"border-t border-border font-sans text-sm transition-colors duration-150";
	const expandedClasses = input.isExpanded
		? "max-h-[200px] overflow-y-auto"
		: "h-[72px] overflow-hidden";
	const clickableClasses = input.isClickable
		? "cursor-pointer hover:bg-muted/50"
		: "";
	return `${base} ${expandedClasses} ${clickableClasses}`;
}
