import type { CheckpointData, FileRowState, CheckpointFile as UICheckpointFile } from "@acepe/ui";
import type { Checkpoint, FileSnapshot } from "../../types/checkpoint.js";

export function buildCheckpointCardData(input: {
	readonly checkpoint: Checkpoint;
	readonly userMessagePreview: string | null;
}): CheckpointData {
	return {
		id: input.checkpoint.id,
		number: input.checkpoint.checkpointNumber,
		message: input.userMessagePreview,
		timestamp: input.checkpoint.createdAt,
		fileCount: input.checkpoint.fileCount,
		totalInsertions: input.checkpoint.totalLinesAdded,
		totalDeletions: input.checkpoint.totalLinesRemoved,
		isAuto: input.checkpoint.isAuto,
	};
}

export function buildCheckpointFiles(fileSnapshots: readonly FileSnapshot[]): UICheckpointFile[] {
	return fileSnapshots
		.filter((file) => (file.linesAdded ?? 0) > 0 || (file.linesRemoved ?? 0) > 0)
		.map((file) => ({
			id: file.id,
			filePath: file.filePath,
			linesAdded: file.linesAdded,
			linesRemoved: file.linesRemoved,
			fileSize: file.fileSize,
		}));
}

export function getDefaultCheckpointFileRowState(): FileRowState {
	return {
		isDiffExpanded: false,
		isLoadingDiff: false,
		isReverting: false,
		diff: null,
	};
}

export function buildCheckpointFileRevertState(
	currentState: FileRowState | undefined,
	isReverting: boolean
): FileRowState {
	return {
		...(currentState ?? getDefaultCheckpointFileRowState()),
		isReverting,
	};
}

export function buildCheckpointDiffLoadingState(): FileRowState {
	return {
		isDiffExpanded: true,
		isLoadingDiff: true,
		isReverting: false,
		diff: null,
	};
}

export function buildCheckpointDiffLoadedState(input: {
	readonly filePath: string;
	readonly oldContent: string | null;
	readonly newContent: string;
}): FileRowState {
	return {
		isDiffExpanded: true,
		isLoadingDiff: false,
		isReverting: false,
		diff: {
			filePath: input.filePath,
			content: input.newContent,
			oldContent: input.oldContent,
			language: getCheckpointLanguageFromPath(input.filePath),
		},
	};
}

export function buildCheckpointDiffLoadFailedState(): FileRowState {
	return {
		isDiffExpanded: true,
		isLoadingDiff: false,
		isReverting: false,
		diff: null,
	};
}

export function buildCheckpointDiffToggleState(input: {
	readonly currentState: FileRowState | undefined;
	readonly isDiffExpanded: boolean;
}): FileRowState {
	return {
		isDiffExpanded: input.isDiffExpanded,
		isLoadingDiff: false,
		isReverting: input.currentState?.isReverting ?? false,
		diff: input.currentState?.diff ?? null,
	};
}

export function getCheckpointFileName(filePath: string): string {
	return filePath.split("/").pop() ?? filePath;
}

export function getCheckpointLanguageFromPath(filePath: string): string {
	const extension = filePath.split(".").pop()?.toLowerCase();
	const languageByExtension: Record<string, string> = {
		ts: "typescript",
		tsx: "typescript",
		js: "javascript",
		jsx: "javascript",
		svelte: "svelte",
		rs: "rust",
		py: "python",
		json: "json",
		md: "markdown",
		css: "css",
		html: "html",
	};

	return languageByExtension[extension ?? ""] ?? "text";
}
