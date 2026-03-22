/**
 * View mode derivations – single place that defines what single/project/multi mean.
 *
 * Semantics:
 * - single: fullscreen layout, one panel (the focused panel)
 * - project: card layout, one project visible at a time (others hidden)
 * - multi: card layout, all projects visible
 *
 * Consumers (e.g. panels-container) should use getViewModeState() instead of
 * reading panelStore.viewMode / focusedViewProjectPath directly for layout logic.
 */

import type { PanelStore } from "$lib/acp/store/panel-store.svelte.js";

/** Minimal panel shape needed to resolve fullscreen panel and active project */
export interface PanelWithProject {
	readonly id: string;
	readonly sessionProjectPath: string | null;
}

/** Minimal group shape for active project and focusedModeAllProjects */
export interface ProjectGroupRef {
	readonly projectPath: string;
	readonly projectName: string;
	readonly projectColor: string;
}

export interface ViewModeState {
	/** "fullscreen" when single or explicit fullscreen panel; "cards" for project/multi */
	readonly layout: "fullscreen" | "cards";
	readonly isSingleMode: boolean;
	/** Same as layout === "fullscreen" */
	readonly isFullscreenMode: boolean;
	/** Which project is visible in card layout when not multi; null when multi or only one group */
	readonly activeProjectPath: string | null;
	/** List of projects for project switcher when in project/single (card layout); undefined when multi or one group */
	readonly focusedModeAllProjects:
		| readonly { name: string; color: string; path: string }[]
		| undefined;
	/** The panel to show in fullscreen layout; null when layout is "cards" */
	readonly fullscreenPanel: PanelWithProject | null;
}

export interface GetViewModeStateContext {
	panelsWithState: readonly PanelWithProject[];
	allGroups: readonly ProjectGroupRef[];
}

/**
 * Returns all view-mode-derived state from panel store and context.
 * Call from $derived.by(() => getViewModeState(panelStore, { panelsWithState, allGroups })).
 */
export function getViewModeState(
	panelStore: PanelStore,
	context: GetViewModeStateContext
): ViewModeState {
	const { panelsWithState, allGroups } = context;
	const viewMode = panelStore.viewMode;
	const isSingleMode = viewMode === "single";
	const isFullscreenMode = panelStore.fullscreenPanelId !== null || isSingleMode;
	const layout: "fullscreen" | "cards" = isFullscreenMode ? "fullscreen" : "cards";

	const fullscreenPanel: PanelWithProject | null = (() => {
		if (panelStore.fullscreenPanelId !== null) {
			const p = panelsWithState.find((x) => x.id === panelStore.fullscreenPanelId);
			return p ?? null;
		}
		if (isSingleMode) {
			const p =
				panelsWithState.find((x) => x.id === panelStore.focusedPanelId) ??
				panelsWithState[0] ??
				null;
			return p ?? null;
		}
		return null;
	})();

	const activeProjectPath: string | null =
		viewMode === "multi" || allGroups.length <= 1
			? null
			: (() => {
					const manual = panelStore.focusedViewProjectPath;
					if (manual && allGroups.some((g) => g.projectPath === manual)) {
						return manual;
					}
					const focused = panelsWithState.find((p) => p.id === panelStore.focusedPanelId);
					return focused?.sessionProjectPath ?? allGroups[0]?.projectPath ?? null;
				})();

	const focusedModeAllProjects:
		| readonly { name: string; color: string; path: string }[]
		| undefined =
		viewMode !== "multi" && allGroups.length > 1
			? allGroups.map((g) => ({
					name: g.projectName,
					color: g.projectColor,
					path: g.projectPath,
				}))
			: undefined;

	return {
		layout,
		isSingleMode,
		isFullscreenMode,
		activeProjectPath,
		focusedModeAllProjects,
		fullscreenPanel,
	};
}
