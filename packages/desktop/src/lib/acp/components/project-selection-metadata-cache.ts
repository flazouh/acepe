import type { FileGitStatus } from "$lib/services/converted-session-types.js";

export type ProjectSelectionMetadata = {
	branch: string | null;
	gitStatus: ReadonlyArray<FileGitStatus> | null;
};

export type ProjectSelectionMetadataField = "branch" | "gitStatus";

type ProjectSelectionMetadataLoadState = {
	branchLoaded: boolean;
	gitStatusLoaded: boolean;
	branchInFlight: boolean;
	gitStatusInFlight: boolean;
};

const loadStateByProject = new Map<string, ProjectSelectionMetadataLoadState>();
const projectMetadataCache = new Map<string, ProjectSelectionMetadata>();

function getOrInitLoadState(projectPath: string): ProjectSelectionMetadataLoadState {
	const existing = loadStateByProject.get(projectPath);
	if (existing) {
		return existing;
	}

	const initial: ProjectSelectionMetadataLoadState = {
		branchLoaded: false,
		gitStatusLoaded: false,
		branchInFlight: false,
		gitStatusInFlight: false,
	};
	loadStateByProject.set(projectPath, initial);
	return initial;
}

export function shouldLoadProjectSelectionMetadata(projectPath: string): boolean {
	const state = loadStateByProject.get(projectPath);
	if (!state) {
		return true;
	}

	const hasMissingData = !state.branchLoaded || !state.gitStatusLoaded;
	const hasInFlightLoad = state.branchInFlight || state.gitStatusInFlight;
	return hasMissingData && !hasInFlightLoad;
}

export function shouldLoadProjectSelectionMetadataField(
	projectPath: string,
	field: ProjectSelectionMetadataField
): boolean {
	const state = getOrInitLoadState(projectPath);

	if (field === "branch") {
		return !state.branchLoaded && !state.branchInFlight;
	}

	return !state.gitStatusLoaded && !state.gitStatusInFlight;
}

export function markProjectSelectionMetadataFieldLoadStarted(
	projectPath: string,
	field: ProjectSelectionMetadataField
): void {
	const state = getOrInitLoadState(projectPath);

	if (field === "branch") {
		state.branchInFlight = true;
		return;
	}

	state.gitStatusInFlight = true;
}

export function markProjectSelectionMetadataFieldLoadFinished(
	projectPath: string,
	field: ProjectSelectionMetadataField,
	successful: boolean
): void {
	const state = getOrInitLoadState(projectPath);

	if (field === "branch") {
		state.branchInFlight = false;
		if (successful) {
			state.branchLoaded = true;
		}
		return;
	}

	state.gitStatusInFlight = false;
	if (successful) {
		state.gitStatusLoaded = true;
	}
}

export function getCachedProjectSelectionMetadata(
	projectPath: string
): ProjectSelectionMetadata | undefined {
	return projectMetadataCache.get(projectPath);
}

export function setCachedProjectSelectionMetadata(
	projectPath: string,
	metadata: ProjectSelectionMetadata
): void {
	projectMetadataCache.set(projectPath, metadata);
}

export function clearProjectSelectionMetadataCacheForTests(): void {
	loadStateByProject.clear();
	projectMetadataCache.clear();
}
