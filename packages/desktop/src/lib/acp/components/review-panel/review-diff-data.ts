import { type FileContents, parseDiffFromFile } from "@pierre/diffs";

import type { ModifiedFileEntry } from "../../types/modified-file-entry.js";
import type { ReviewDiffData } from "../modified-files/components/review-diff-view-state.svelte.js";

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
