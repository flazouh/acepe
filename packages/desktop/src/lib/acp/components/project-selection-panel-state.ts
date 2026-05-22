import type { Project } from "../logic/project-manager.svelte.js";
import type { ProjectCardData } from "./project-card-data.js";

export interface ProjectSelectionMetadata {
	readonly branch: string | null;
	readonly gitStatus: ProjectCardData["gitStatus"];
}

export interface ProjectSelectionRemoteStatus {
	readonly ahead: number;
	readonly behind: number;
}

export function getProjectSelectionModifierSymbol(platform: string | null | undefined): string {
	return platform?.includes("Mac") ? "⌘" : "Ctrl";
}

export function getProjectSelectionPathsKey(projects: readonly Pick<Project, "path">[]): string {
	return projects.map((project) => project.path).join("\n");
}

export function isProjectSelectionTextInputTarget(target: EventTarget | null): boolean {
	const tagName = (target as { tagName?: unknown } | null)?.tagName;
	return tagName === "INPUT" || tagName === "TEXTAREA";
}

export function getProjectSelectionShortcutIndex(input: {
	key: string;
	isMac: boolean;
	metaKey: boolean;
	ctrlKey: boolean;
	altKey: boolean;
	shiftKey: boolean;
}): number | null {
	const hasModifier = input.isMac ? input.metaKey : input.ctrlKey;
	const hasWrongModifier = input.isMac ? input.ctrlKey : input.metaKey;
	if (!hasModifier || hasWrongModifier || input.altKey || input.shiftKey) {
		return null;
	}

	if (input.key < "1" || input.key > "9") {
		return null;
	}

	return Number.parseInt(input.key, 10) - 1;
}

export function getSelectableProjectByIndex<TProject extends Pick<Project, "path">>(input: {
	projects: readonly TProject[];
	index: number;
	missingProjectPaths: ReadonlySet<string>;
}): TProject | null {
	const project = input.projects[input.index];
	if (!project || input.missingProjectPaths.has(project.path)) {
		return null;
	}
	return project;
}

export function shouldSyncProjectSelectionMetadata(input: {
	displayProjectsKey: string;
	lastDisplayProjectsKey: string;
	hasRetryableMetadata: boolean;
}): boolean {
	return input.displayProjectsKey !== input.lastDisplayProjectsKey || input.hasRetryableMetadata;
}

export function buildProjectSelectionCardDataList(input: {
	readonly displayProjects: readonly Project[];
	readonly cardDataByPath: Pick<ReadonlyMap<string, ProjectSelectionMetadata>, "get">;
	readonly getCachedMetadata: (projectPath: string) => ProjectSelectionMetadata | null | undefined;
	readonly remoteStatusByPath: Pick<ReadonlyMap<string, ProjectSelectionRemoteStatus>, "get">;
}): ProjectCardData[] {
	return input.displayProjects.map((project) => {
		const cached =
			input.cardDataByPath.get(project.path) ?? input.getCachedMetadata(project.path) ?? null;
		const remote = input.remoteStatusByPath.get(project.path);
		return {
			project,
			branch: cached?.branch ?? null,
			gitStatus: cached?.gitStatus ?? null,
			ahead: remote?.ahead ?? null,
			behind: remote?.behind ?? null,
		};
	});
}
