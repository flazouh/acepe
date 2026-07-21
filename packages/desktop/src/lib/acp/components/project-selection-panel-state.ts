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

export type ProjectSelectionMetadataScheduler = (callback: () => void) => () => void;
export type ProjectSelectionDelayScheduler = (callback: () => void, delayMs: number) => () => void;
export type ProjectSelectionIdleScheduler = (callback: () => void, timeoutMs: number) => () => void;

const PROJECT_SELECTION_METADATA_DELAY_MS = 5_000;
const PROJECT_SELECTION_METADATA_IDLE_TIMEOUT_MS = 5_000;

function scheduleProjectSelectionDelay(callback: () => void, delayMs: number): () => void {
	const timer = setTimeout(callback, delayMs);
	return () => {
		clearTimeout(timer);
	};
}

function scheduleProjectSelectionIdle(callback: () => void, timeoutMs: number): () => void {
	if (typeof window !== "undefined") {
		const schedulingWindow = window as Window & {
			requestIdleCallback?: (callback: IdleRequestCallback, options?: IdleRequestOptions) => number;
			cancelIdleCallback?: (handle: number) => void;
		};
		if (typeof schedulingWindow.requestIdleCallback === "function") {
			const idleCallbackId = schedulingWindow.requestIdleCallback(callback, {
				timeout: timeoutMs,
			});
			return () => {
				schedulingWindow.cancelIdleCallback?.(idleCallbackId);
			};
		}
	}

	const timer = setTimeout(callback, 0);
	return () => {
		clearTimeout(timer);
	};
}

export function createProjectSelectionMetadataScheduler(
	options: {
		readonly delayMs?: number;
		readonly idleTimeoutMs?: number;
		readonly scheduleDelay?: ProjectSelectionDelayScheduler;
		readonly scheduleIdle?: ProjectSelectionIdleScheduler;
	} = {}
): ProjectSelectionMetadataScheduler {
	const delayMs = options.delayMs ?? PROJECT_SELECTION_METADATA_DELAY_MS;
	const idleTimeoutMs = options.idleTimeoutMs ?? PROJECT_SELECTION_METADATA_IDLE_TIMEOUT_MS;
	const scheduleDelay = options.scheduleDelay ?? scheduleProjectSelectionDelay;
	const scheduleIdle = options.scheduleIdle ?? scheduleProjectSelectionIdle;

	return (callback) => {
		let cancelled = false;
		let cancelIdle: (() => void) | null = null;
		const cancelDelay = scheduleDelay(() => {
			if (cancelled) {
				return;
			}
			cancelIdle = scheduleIdle(() => {
				if (!cancelled) {
					callback();
				}
			}, idleTimeoutMs);
		}, delayMs);

		return () => {
			cancelled = true;
			cancelDelay();
			if (cancelIdle !== null) {
				cancelIdle();
			}
		};
	};
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
