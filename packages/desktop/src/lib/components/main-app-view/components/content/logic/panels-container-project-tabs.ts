import type { ViewModeState } from "$lib/acp/logic/view-mode-state.js";

export interface PanelsContainerProjectTabGroup {
	readonly projectPath: string;
	readonly agentPanels: readonly unknown[];
}

export interface PanelsContainerProjectTab {
	readonly name: string;
	readonly color: string;
	readonly path: string;
	readonly iconSrc: string | null;
	readonly sessionCount: number;
}

export function buildPanelsContainerProjectTabs(input: {
	readonly projects: NonNullable<ViewModeState["focusedModeAllProjects"]>;
	readonly groups: readonly PanelsContainerProjectTabGroup[];
}): PanelsContainerProjectTab[] {
	return input.projects.map((project) => {
		const group = input.groups.find((candidate) => candidate.projectPath === project.path);
		return {
			name: project.name,
			color: project.color,
			path: project.path,
			iconSrc: project.iconSrc,
			sessionCount: group ? group.agentPanels.length : 0,
		};
	});
}

export function shouldShowPanelsContainerProjectTabBar(input: {
	readonly viewModeState: Pick<ViewModeState, "layout" | "activeProjectPath" | "isFullscreenMode">;
	readonly projectTabCount: number;
}): boolean {
	return (
		input.viewModeState.layout === "cards" &&
		input.viewModeState.activeProjectPath !== null &&
		input.projectTabCount > 1 &&
		!input.viewModeState.isFullscreenMode
	);
}
