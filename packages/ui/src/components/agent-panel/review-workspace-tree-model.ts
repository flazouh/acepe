import type { FileTreeRowDecoration } from "@pierre/trees";

import type { ReviewWorkspaceFileItem } from "./types.js";

export interface ReviewWorkspaceTreeEntry {
	file: ReviewWorkspaceFileItem;
	index: number;
}

export interface ReviewWorkspaceTreeModel {
	paths: readonly string[];
	selectedPath: string | null;
	initialExpandedPaths: readonly string[];
	filesByPath: ReadonlyMap<string, ReviewWorkspaceTreeEntry>;
	decorationsByPath: ReadonlyMap<string, FileTreeRowDecoration>;
}

export function createReviewWorkspaceTreeModel(
	files: readonly ReviewWorkspaceFileItem[],
	selectedIndex?: number | null,
): ReviewWorkspaceTreeModel {
	const paths: string[] = [];
	const filesByPath = new Map<string, ReviewWorkspaceTreeEntry>();
	const decorationsByPath = new Map<string, FileTreeRowDecoration>();
	let selectedPath: string | null = null;

	for (let index = 0; index < files.length; index += 1) {
		const file = files[index];
		paths.push(file.filePath);
		filesByPath.set(file.filePath, {
			file,
			index,
		});
		decorationsByPath.set(
			file.filePath,
			createReviewWorkspaceTreeDecoration(file),
		);

		if (index === selectedIndex) {
			selectedPath = file.filePath;
		}
	}

	return {
		paths,
		selectedPath,
		initialExpandedPaths: selectedPath
			? createSelectedFileExpandedPaths(selectedPath)
			: [],
		filesByPath,
		decorationsByPath,
	};
}

export function createReviewWorkspaceTreeDecoration(
	file: ReviewWorkspaceFileItem,
): FileTreeRowDecoration {
	const reviewText = reviewStatusText(file);
	const resetText = resetStatusText(file);
	const diffText = diffSummaryText(file);
	const statusText = resetText ?? reviewText;
	const text = diffText.length > 0 ? `${statusText} ${diffText}` : statusText;
	const additionLabel = file.additions === 1 ? "addition" : "additions";
	const deletionLabel = file.deletions === 1 ? "deletion" : "deletions";

	return {
		text,
		title: `${file.filePath}: ${statusText}, ${file.additions} ${additionLabel}, ${file.deletions} ${deletionLabel}`,
	};
}

function resetStatusText(file: ReviewWorkspaceFileItem): string | null {
	if (file.resetStatusLabel) {
		return file.resetStatusLabel;
	}

	if (file.resetStatus === "confirming") {
		return "Confirm reset";
	}

	if (file.resetStatus === "resetting") {
		return "Resetting";
	}

	if (file.resetStatus === "reset") {
		return "Reset";
	}

	if (file.resetStatus === "failed") {
		return "Reset failed";
	}

	return null;
}

function reviewStatusText(file: ReviewWorkspaceFileItem): string {
	if (isReviewedFile(file)) {
		return "Reviewed";
	}

	return "Needs review";
}

function isReviewedFile(file: ReviewWorkspaceFileItem): boolean {
	const reviewStatus = String(file.reviewStatus ?? "unreviewed");
	return reviewStatus === "reviewed" || reviewStatus === "accepted";
}

function diffSummaryText(file: ReviewWorkspaceFileItem): string {
	if (file.additions === 0 && file.deletions === 0) {
		return "";
	}

	return `+${file.additions} -${file.deletions}`;
}

function createSelectedFileExpandedPaths(filePath: string): readonly string[] {
	const normalizedPath = filePath.replaceAll("\\", "/");
	const segments = normalizedPath
		.split("/")
		.filter((segment) => segment.length > 0);
	const expandedPaths: string[] = [];
	let parentPath = "";

	for (let index = 0; index < segments.length - 1; index += 1) {
		parentPath =
			parentPath.length === 0
				? segments[index]
				: `${parentPath}/${segments[index]}`;
		expandedPaths.push(`${parentPath}/`);
	}

	return expandedPaths;
}
