import type { Project } from "../logic/project-manager.svelte.js";

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
