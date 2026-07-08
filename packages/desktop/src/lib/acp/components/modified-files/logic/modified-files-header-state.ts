import type { AgentPanelFileReviewStatus } from "@acepe/ui";
import type { ModifiedFilesState } from "../../../types/modified-files-state.js";
import type { FileReviewStatus } from "../../review-panel/review-session-state.js";
import {
	DEFAULT_SHIP_INSTRUCTIONS,
	normalizeCustomShipInstructions,
} from "./build-pr-prompt-preview.js";

export interface ModifiedFilesDiffTotals {
	readonly totalAdded: number;
	readonly totalRemoved: number;
}

export function getModifiedFilesDiffTotals(
	modifiedFilesState: ModifiedFilesState | null
): ModifiedFilesDiffTotals {
	if (!modifiedFilesState) {
		return {
			totalAdded: 0,
			totalRemoved: 0,
		};
	}

	return modifiedFilesState.files.reduce<ModifiedFilesDiffTotals>(
		(totals, file) => ({
			totalAdded: totals.totalAdded + file.totalAdded,
			totalRemoved: totals.totalRemoved + file.totalRemoved,
		}),
		{
			totalAdded: 0,
			totalRemoved: 0,
		}
	);
}

export function countReviewedFiles(
	modifiedFilesState: ModifiedFilesState | null,
	reviewStatusByFilePath: ReadonlyMap<string, FileReviewStatus | undefined>
): number {
	if (!modifiedFilesState) return 0;

	return modifiedFilesState.files.reduce((count, file) => {
		const status = reviewStatusByFilePath.get(file.filePath);
		return status === "reviewed" ? count + 1 : count;
	}, 0);
}

export function isModifiedFilesReviewComplete(
	modifiedFilesState: ModifiedFilesState | null,
	reviewedFileCount: number
): boolean {
	if (!modifiedFilesState) return false;
	if (modifiedFilesState.fileCount === 0) return false;
	return reviewedFileCount === modifiedFilesState.fileCount;
}

interface KeepAllStateInput {
	readonly sessionId: string | null;
	readonly isSessionReviewLoaded: boolean;
	readonly isKeepAllApplied: boolean;
}

export function canKeepAllFiles(input: KeepAllStateInput): boolean {
	if (!input.sessionId) return false;
	if (!input.isSessionReviewLoaded) return false;
	return !input.isKeepAllApplied;
}

export function mapReviewStatusForHeader(
	status: FileReviewStatus | undefined
): AgentPanelFileReviewStatus {
	if (status === "reviewed") {
		return "reviewed";
	}

	return "unreviewed";
}

export interface PromptEditorState {
	readonly baseline: string;
	readonly value: string;
	readonly helperText: string;
	readonly hasUnsavedChanges: boolean;
	readonly canSave: boolean;
	readonly canReset: boolean;
	readonly statusLabel: "Unsaved draft" | "Custom" | "Default";
}

interface PromptEditorStateInput {
	readonly savedPrompt: string | null | undefined;
	readonly hasPromptDraft: boolean;
	readonly promptDraft: string;
}

export function getPromptEditorState(input: PromptEditorStateInput): PromptEditorState {
	const normalizedSavedPrompt = normalizeCustomShipInstructions(input.savedPrompt ?? undefined);
	const baseline = normalizedSavedPrompt || DEFAULT_SHIP_INSTRUCTIONS;
	const value = input.hasPromptDraft ? input.promptDraft : baseline;
	const hasUnsavedChanges = input.hasPromptDraft && input.promptDraft !== baseline;
	const canSave = hasUnsavedChanges && value.trim().length > 0;
	const canReset = input.hasPromptDraft || Boolean(normalizedSavedPrompt);

	let statusLabel: PromptEditorState["statusLabel"] = "Default";
	if (hasUnsavedChanges) {
		statusLabel = "Unsaved draft";
	} else if (normalizedSavedPrompt) {
		statusLabel = "Custom";
	}

	return {
		baseline,
		value,
		helperText:
			"Acepe adds the XML response format, current branch, changed files, and diff automatically.",
		hasUnsavedChanges,
		canSave,
		canReset,
		statusLabel,
	};
}
