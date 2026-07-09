import { type FileContents, parseDiffFromFile } from "@pierre/diffs";

import type { ModifiedFileEntry } from "../../types/modified-file-entry.js";
import type { ReviewDiffData } from "../modified-files/components/review-diff-view-state.svelte.js";

function replaceFirstOccurrence(
	content: string,
	search: string,
	replacement: string
): string | null {
	const index = content.indexOf(search);
	if (index < 0) {
		return null;
	}

	return content.slice(0, index) + replacement + content.slice(index + search.length);
}

function applyEditSnippetsForward(baseContent: string, file: ModifiedFileEntry): string | null {
	const edits = file.edits ?? [];
	if (edits.length === 0) {
		return null;
	}

	let nextContent = baseContent;
	let changed = false;

	for (const edit of edits) {
		if (edit.content !== null) {
			if (nextContent !== edit.content) {
				changed = true;
			}
			nextContent = edit.content;
			continue;
		}

		if (edit.oldString === null || edit.newString === null) {
			return null;
		}

		const replacedContent = replaceFirstOccurrence(nextContent, edit.oldString, edit.newString);
		if (replacedContent === null) {
			return null;
		}

		if (replacedContent !== nextContent) {
			changed = true;
		}
		nextContent = replacedContent;
	}

	return changed ? nextContent : null;
}

function applyEditSnippetsBackward(baseContent: string, file: ModifiedFileEntry): string | null {
	const edits = file.edits ?? [];
	if (edits.length === 0) {
		return null;
	}

	let previousContent = baseContent;
	let changed = false;

	for (let index = edits.length - 1; index >= 0; index -= 1) {
		const edit = edits[index];
		if (!edit || edit.oldString === null || edit.newString === null) {
			return null;
		}

		const replacedContent = replaceFirstOccurrence(previousContent, edit.newString, edit.oldString);
		if (replacedContent === null) {
			return null;
		}

		if (replacedContent !== previousContent) {
			changed = true;
		}
		previousContent = replacedContent;
	}

	return changed ? previousContent : null;
}

export function createReviewDiffData(
	file: ModifiedFileEntry,
	oldContent: string | null,
	newContent: string | null
): ReviewDiffData | null {
	if (oldContent === null && newContent === null) {
		return null;
	}

	const cacheKey = `review-${file.filePath}`;

	const oldFile: FileContents = {
		name: file.fileName,
		contents: oldContent ?? "",
		cacheKey: `${cacheKey}-old`,
	};

	const newFile: FileContents = {
		name: file.fileName,
		contents: newContent ?? "",
		cacheKey: `${cacheKey}-new`,
	};

	return {
		oldFile,
		newFile,
		fileDiffMetadata: parseDiffFromFile(oldFile, newFile),
	};
}

export function createReviewDiffDataFromBaseAndEdits(
	file: ModifiedFileEntry,
	baseContent: string | null
): ReviewDiffData | null {
	if (baseContent === null) {
		return null;
	}

	const forwardContent = applyEditSnippetsForward(baseContent, file);
	if (forwardContent !== null) {
		return createReviewDiffData(file, baseContent, forwardContent);
	}

	const backwardContent = applyEditSnippetsBackward(baseContent, file);
	if (backwardContent !== null) {
		return createReviewDiffData(file, backwardContent, baseContent);
	}

	return null;
}

function hasDiffHunks(diffData: ReviewDiffData | null): boolean {
	return (diffData?.fileDiffMetadata.hunks.length ?? 0) > 0;
}

function isMisleadingWholeFileAdditionDiff(
	diffData: ReviewDiffData | null,
	file: ModifiedFileEntry | undefined
): boolean {
	if (!diffData || !file) {
		return false;
	}

	if (diffData.oldFile.contents.length > 0) {
		return false;
	}

	if (diffData.newFile.contents.length === 0) {
		return false;
	}

	if (file.totalRemoved > 0) {
		return true;
	}

	if (file.originalContent !== null && file.originalContent.length > 0) {
		return true;
	}

	return false;
}

interface SelectReviewDiffDataOptions {
	preferFetchedDiff?: boolean;
	fetchedDiffSettled?: boolean;
	file?: ModifiedFileEntry;
}

export function selectReviewDiffData(
	fetchedDiffData: ReviewDiffData | null,
	embeddedDiffData: ReviewDiffData | null,
	options: SelectReviewDiffDataOptions = {}
): ReviewDiffData | null {
	if (options.preferFetchedDiff === true && options.fetchedDiffSettled !== true) {
		return fetchedDiffData;
	}

	const file = options.file;
	const usableFetchedDiff = isMisleadingWholeFileAdditionDiff(fetchedDiffData, file)
		? null
		: fetchedDiffData;
	const usableEmbeddedDiff = isMisleadingWholeFileAdditionDiff(embeddedDiffData, file)
		? null
		: embeddedDiffData;

	if (hasDiffHunks(usableFetchedDiff)) {
		return usableFetchedDiff;
	}

	if (hasDiffHunks(usableEmbeddedDiff)) {
		return usableEmbeddedDiff;
	}

	return usableFetchedDiff ?? usableEmbeddedDiff;
}
