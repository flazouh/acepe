import type { ProjectPanelGroup } from "../panel-grouping.js";

export interface PanelsContainerAgentProjectRef {
	readonly id: string;
	readonly sessionProjectPath: string | null;
	readonly sessionSequenceId: number | null;
}

export type StablePanelsContainerProjectGroup = ProjectPanelGroup<PanelsContainerAgentProjectRef>;

function arraysMatchById<T extends { readonly id: string }>(
	left: readonly T[],
	right: readonly T[]
): boolean {
	return left.length === right.length && left.every((item, index) => item.id === right[index]?.id);
}

function agentArraysMatch(
	left: readonly PanelsContainerAgentProjectRef[],
	right: readonly PanelsContainerAgentProjectRef[]
): boolean {
	return (
		left.length === right.length &&
		left.every(
			(item, index) =>
				item.id === right[index]?.id &&
				item.sessionProjectPath === right[index]?.sessionProjectPath &&
				item.sessionSequenceId === right[index]?.sessionSequenceId
		)
	);
}

function canReuseProjectGroup(
	cached: StablePanelsContainerProjectGroup | undefined,
	next: StablePanelsContainerProjectGroup
): cached is StablePanelsContainerProjectGroup {
	return (
		cached !== undefined &&
		cached.projectName === next.projectName &&
		cached.projectColor === next.projectColor &&
		cached.projectIconSrc === next.projectIconSrc &&
		agentArraysMatch(cached.agentPanels, next.agentPanels) &&
		arraysMatchById(cached.filePanels, next.filePanels) &&
		arraysMatchById(cached.reviewPanels, next.reviewPanels) &&
		arraysMatchById(cached.terminalPanels, next.terminalPanels) &&
		arraysMatchById(cached.browserPanels, next.browserPanels) &&
		arraysMatchById(cached.gitPanels, next.gitPanels)
	);
}

export interface PanelsContainerProjectGroupStabilizer {
	stabilize(
		nextGroups: readonly StablePanelsContainerProjectGroup[]
	): StablePanelsContainerProjectGroup[];
}

export function createPanelsContainerProjectGroupStabilizer(): PanelsContainerProjectGroupStabilizer {
	const cache = new Map<string, StablePanelsContainerProjectGroup>();

	return {
		stabilize(nextGroups) {
			const nextCache = new Map<string, StablePanelsContainerProjectGroup>();
			const stabilized = nextGroups.map((group) => {
				const cached = cache.get(group.projectPath);
				const value = canReuseProjectGroup(cached, group) ? cached : group;
				nextCache.set(group.projectPath, value);
				return value;
			});

			cache.clear();
			for (const [projectPath, group] of nextCache.entries()) {
				cache.set(projectPath, group);
			}
			return stabilized;
		},
	};
}
