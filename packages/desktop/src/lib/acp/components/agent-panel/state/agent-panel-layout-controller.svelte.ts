/**
 * AgentPanelLayoutController — owns panel width/sidebar layout derivations
 * hoisted from agent-panel.svelte (attached pane, plan/browser sidebars, width styles).
 */

import type { PanelStore } from "../../../store/panel-store.svelte.js";
import {
	resolveAgentContentColumnStyle,
	resolveAgentPanelEffectiveWidth,
	resolveAgentPanelWidthStyle,
	shouldUseCenteredFullscreenContent,
} from "../components/agent-panel-layout.js";

export const ATTACHED_COLUMN_WIDTH = 450;
export const PLAN_SIDEBAR_COLUMN_WIDTH = 450;
export const BROWSER_SIDEBAR_COLUMN_WIDTH = 500;
export const ATTACHED_COLUMN_GAP_WIDTH = 2;

export interface AgentPanelLayoutControllerDeps {
	getPanelId: () => string | undefined;
	getPanelWidth: () => number | undefined;
	getHasAttachedFilePane: () => boolean;
	getIsFullscreen: () => boolean;
	getReviewMode: () => boolean;
	getHasPlan: () => boolean;
	panelStore: PanelStore;
}

export class AgentPanelLayoutController {
	readonly #deps: AgentPanelLayoutControllerDeps;
	#toolbarMinWidth = $state(0);

	constructor(deps: AgentPanelLayoutControllerDeps) {
		this.#deps = deps;
	}

	get toolbarMinWidth(): number {
		return this.#toolbarMinWidth;
	}

	setToolbarMinWidth(value: number): void {
		if (value <= 0) {
			return;
		}

		if (this.#toolbarMinWidth !== 0 && value >= this.#toolbarMinWidth) {
			return;
		}

		this.#toolbarMinWidth = value;
	}

	readonly showPlanSidebar = $derived.by(() => {
		const panelId = this.#deps.getPanelId();
		return panelId ? this.#deps.panelStore.isPlanSidebarExpanded(panelId) : false;
	});

	readonly isTerminalDrawerOpen = $derived.by(() => {
		const panelId = this.#deps.getPanelId();
		return panelId ? this.#deps.panelStore.isEmbeddedTerminalDrawerOpen(panelId) : false;
	});

	readonly showBrowserSidebar = $derived.by(() => {
		const panelId = this.#deps.getPanelId();
		return panelId ? this.#deps.panelStore.isBrowserSidebarExpanded(panelId) : false;
	});

	readonly browserSidebarUrl = $derived.by(() => {
		const panelId = this.#deps.getPanelId();
		return panelId ? (this.#deps.panelStore.getHotState(panelId)?.browserSidebarUrl ?? null) : null;
	});

	readonly toolbarMinWidthWithPadding = $derived.by(() =>
		this.#toolbarMinWidth > 0 ? this.#toolbarMinWidth + 16 : 0
	);

	readonly hasAttachedPane = $derived.by(
		() => Boolean(this.#deps.getPanelId()) && this.#deps.getHasAttachedFilePane()
	);

	readonly requiredSplitWidth = $derived.by(() =>
		this.hasAttachedPane ? ATTACHED_COLUMN_WIDTH * 2 + ATTACHED_COLUMN_GAP_WIDTH : 0
	);

	readonly panelRenderWidth = $derived.by(() =>
		this.hasAttachedPane ? this.requiredSplitWidth : this.#deps.getPanelWidth()
	);

	readonly centeredFullscreenContent = $derived.by(() =>
		shouldUseCenteredFullscreenContent({
			hasAttachedPane: this.hasAttachedPane,
			isFullscreen: this.#deps.getIsFullscreen(),
		})
	);

	readonly agentContentColumnStyle = $derived.by(() =>
		resolveAgentContentColumnStyle({
			hasAttachedPane: this.hasAttachedPane,
			isFullscreen: this.#deps.getIsFullscreen(),
			attachedColumnWidth: ATTACHED_COLUMN_WIDTH,
		})
	);

	readonly baseWidth = $derived.by(() =>
		Math.max(this.panelRenderWidth ?? 0, this.toolbarMinWidthWithPadding)
	);

	readonly effectiveWidth = $derived.by(() =>
		resolveAgentPanelEffectiveWidth({
			baseWidth: this.baseWidth,
			reviewMode: this.#deps.getReviewMode(),
			showPlanSidebar: this.showPlanSidebar,
			hasPlan: this.#deps.getHasPlan(),
			planSidebarColumnWidth: PLAN_SIDEBAR_COLUMN_WIDTH,
			showBrowserSidebar: this.showBrowserSidebar,
			browserSidebarColumnWidth: BROWSER_SIDEBAR_COLUMN_WIDTH,
		})
	);

	readonly widthStyle = $derived.by(() =>
		resolveAgentPanelWidthStyle({
			effectiveWidth: this.effectiveWidth,
			isFullscreen: this.#deps.getIsFullscreen(),
		})
	);

	togglePlanSidebar(): void {
		const panelId = this.#deps.getPanelId();
		if (!panelId) {
			return;
		}
		this.#deps.panelStore.setPlanSidebarExpanded(panelId, !this.showPlanSidebar);
	}

	toggleBrowserSidebar(): void {
		const panelId = this.#deps.getPanelId();
		if (!panelId) {
			return;
		}
		this.#deps.panelStore.setBrowserSidebarExpanded(panelId, !this.showBrowserSidebar);
	}

	toggleTerminalDrawer(): void {
		const panelId = this.#deps.getPanelId();
		if (!panelId) {
			return;
		}
		this.#deps.panelStore.setEmbeddedTerminalDrawerOpen(panelId, !this.isTerminalDrawerOpen);
	}
}
